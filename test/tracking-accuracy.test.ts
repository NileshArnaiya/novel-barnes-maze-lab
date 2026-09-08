import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBackground, detectBlob, type Frame } from '../src/tracking/blob';
import { detectMaze } from '../src/tracking/mazeDetect';
import { cmToPx, distance } from '../src/core/geometry';

/**
 * Tracking-accuracy validation against hand labels.
 *
 * The detection eval proves the maze is found. It does not prove the tracked
 * point is on the animal, because nothing in it knows where the animal was.
 * This closes that gap with ground truth a person produced: scripts/label-frames.mjs
 * extracts a handful of frames and records where a human clicked the animal, as
 * both a PNG (for the browser) and a PGM (which this test reads with no image
 * library). Here we run the real detector on those exact frames and check the
 * detected centroid lands within a body length of the click.
 *
 * Scope, stated honestly and enforced in the assertions: this is a spot check on
 * a few frames per clip, not a full validation study. A pass means the tracker
 * was on the animal in the checked frames, within tolerance. It does not certify
 * per-frame accuracy over a whole trial. See docs/validation.md.
 *
 * Skips cleanly when no labels exist, so CI and clones without the sample data
 * stay green.
 */

const LABELS_DIR = join(__dirname, 'fixtures', 'labels');

interface LabelFile {
  name: string;
  fps: number;
  width: number;
  height: number;
  points: Record<string, { x: number; y: number }>;
}

/** Read a binary PGM (P5). Handles the greyscale frames the labeller writes. */
function readPgm(path: string): Frame {
  const buf = readFileSync(path);
  let pos = 0;
  const token = (): string => {
    while (pos < buf.length) {
      const c = buf[pos]!;
      if (c === 0x23) while (pos < buf.length && buf[pos] !== 0x0a) pos++;
      else if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) pos++;
      else break;
    }
    const start = pos;
    while (pos < buf.length) {
      const c = buf[pos]!;
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) break;
      pos++;
    }
    return buf.subarray(start, pos).toString('ascii');
  };
  if (token() !== 'P5') throw new Error(`${path} is not a binary PGM`);
  const width = Number(token());
  const height = Number(token());
  token(); // maxval
  pos++;
  return { gray: new Uint8ClampedArray(buf.subarray(pos, pos + width * height)), width, height };
}

const labelFiles = existsSync(LABELS_DIR)
  ? readdirSync(LABELS_DIR).filter((f) => f.endsWith('.labels.json'))
  : [];
const hasLabels = labelFiles.length > 0;

describe.skipIf(!hasLabels)('tracking accuracy against hand labels', () => {
  for (const file of labelFiles) {
    const data = JSON.parse(readFileSync(join(LABELS_DIR, file), 'utf8')) as LabelFile;
    const name = data.name;
    const frameDir = join(LABELS_DIR, name);

    describe(name, () => {
      const labelled = Object.entries(data.points);

      it('has labels and the matching frame images', () => {
        expect(labelled.length).toBeGreaterThan(0);
        expect(existsSync(frameDir)).toBe(true);
      });
      if (labelled.length === 0 || !existsSync(frameDir)) return;

      // Build the background from the labelled frames themselves. The animal is
      // in a different place in each, so the per-pixel median is the empty
      // arena, which is exactly what detectBlob needs to subtract.
      const frames = labelled
        .map(([idx]) => join(frameDir, `${idx}.pgm`))
        .filter(existsSync)
        .map(readPgm);

      it('has enough frames to build a background', () => {
        expect(frames.length).toBeGreaterThanOrEqual(3);
      });
      if (frames.length < 3) return;

      const bg = buildBackground(frames);
      const maze = detectMaze(bg, 20, 92).map;

      it('detects a maze to calibrate against', () => {
        expect(maze).not.toBeNull();
      });
      if (!maze) return;

      // Frames and labels are both full resolution, so no scaling is needed.
      const mask = (x: number, y: number) =>
        (x - maze.platformCenter.x) ** 2 + (y - maze.platformCenter.y) ** 2 <=
        maze.platformRadiusPx ** 2;

      // 6 cm tolerance: a body length. The label is a click somewhere on the
      // animal, the detector returns the centroid, so they differ by roughly a
      // body length even when tracking is perfect. This catches "wrong object",
      // not sub-centimetre error.
      const tolerancePx = cmToPx(maze, 6);

      const errors: number[] = [];
      let detected = 0;
      let empty = 0;

      for (const [idx, label] of labelled) {
        const framePath = join(frameDir, `${idx}.pgm`);
        if (!existsSync(framePath)) continue;
        const frame = readPgm(framePath);
        const blob = detectBlob(frame, bg, 28, 30, mask);
        if (!blob) {
          // No detection. Either an empty frame the labeller sampled at the
          // start, or a genuine miss. Counted and reported, not asserted on.
          empty++;
          continue;
        }
        detected++;
        errors.push(distance(blob.centroid, { x: label.x, y: label.y }));
      }

      it('lands on the animal in the labelled frames', () => {
        const within = errors.filter((e) => e <= tolerancePx).length;
        const sorted = [...errors].sort((a, b) => a - b);
        const medianCm = sorted.length
          ? sorted[Math.floor(sorted.length / 2)]! / cmToPx(maze, 1)
          : NaN;

        console.log(
          `${name}: detected in ${detected}/${labelled.length} labelled frames ` +
            `(${empty} with no detection), ${within}/${errors.length} within 6 cm, ` +
            `median error ${Number.isNaN(medianCm) ? 'n/a' : medianCm.toFixed(1) + ' cm'}`,
        );

        // Must detect the animal in most labelled frames. A frame or two with no
        // detection is fine (an empty start frame, a moment down a hole); most
        // should hit.
        expect(detected).toBeGreaterThanOrEqual(Math.ceil(labelled.length * 0.5));

        // And where detected, most should be within a body length of the click.
        // A shadow-tracker fails this; an animal-tracker clears it.
        expect(within / errors.length).toBeGreaterThanOrEqual(0.6);
      });
    });
  }
});

describe.skipIf(hasLabels)('tracking accuracy', () => {
  it('is skipped without hand labels, and says how to add them', () => {
    expect(hasLabels).toBe(false);
    console.log(
      'Tracking-accuracy validation skipped. To enable it:\n' +
        '  node scripts/label-frames.mjs /path/to/data/barnes-maze/test53.mp4\n' +
        '  (click the animal in each frame, then) pnpm test:eval',
    );
  });
});
