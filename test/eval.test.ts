import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBackground, type Frame } from '../src/tracking/blob';
import { detectHoleRing, detectMaze, detectPlatform } from '../src/tracking/mazeDetect';
import EXPECTED from './expected-detection.json';

/**
 * Evaluation against real footage.
 *
 * The golden tests in core.test.ts prove the measures are correct given a
 * trajectory. They cannot prove the detection works, because a synthetic
 * trajectory has no pixels. This suite closes that gap: it runs the actual
 * platform and hole-ring detectors over frames from the actual sample videos
 * and asserts against values that were measured once, by hand, and reviewed.
 *
 * The fixtures are not committed. They are derived from sample videos we were
 * asked not to redistribute, so `scripts/make-fixtures.sh` regenerates them
 * from a local copy in one command. When they are absent the suite skips
 * rather than failing, so CI stays green for anyone without the data, and the
 * skip message says exactly how to enable it.
 *
 * Tolerances are wide on purpose. The question this suite answers is "does
 * detection land on the right platform", not "does it reproduce a number to
 * three decimals". A tight tolerance here would fail on an ffmpeg version
 * change and teach everyone to ignore the suite.
 */

const FIXTURES = join(__dirname, 'fixtures', 'frames');
const available = existsSync(FIXTURES) && readdirSync(FIXTURES).some((f) => f.endsWith('.pgm'));

describe('sample clips under evaluation', () => {
  it('covers all three recordings, not only one of them', () => {
    expect(Object.keys(EXPECTED.clips).sort()).toEqual(['test50', 'test51', 'test53']);
  });
});

/**
 * Parse a binary PGM (P5).
 *
 * Chosen over PNG because it needs no dependency: a short ASCII header, then
 * one byte per pixel, which is already the format our detectors want.
 */
function readPgm(path: string): Frame {
  const buf = readFileSync(path);

  // Header is whitespace-separated ASCII, and may carry # comment lines.
  let pos = 0;
  const token = (): string => {
    while (pos < buf.length) {
      const c = buf[pos]!;
      if (c === 0x23) {
        while (pos < buf.length && buf[pos] !== 0x0a) pos++;
      } else if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        pos++;
      } else break;
    }
    const start = pos;
    while (pos < buf.length) {
      const c = buf[pos]!;
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) break;
      pos++;
    }
    return buf.subarray(start, pos).toString('ascii');
  };

  const magic = token();
  if (magic !== 'P5') throw new Error(`${path} is not a binary PGM`);
  const width = Number(token());
  const height = Number(token());
  const maxVal = Number(token());
  if (maxVal > 255) throw new Error('16-bit PGM is not supported');
  pos++; // single whitespace byte before the raster

  return {
    gray: new Uint8ClampedArray(buf.subarray(pos, pos + width * height)),
    width,
    height,
  };
}

function loadClip(name: string): Frame[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith(`${name}_`) && f.endsWith('.pgm'))
    .sort()
    .map((f) => readPgm(join(FIXTURES, f)));
}

describe.skipIf(!available)('detection against real footage', () => {
  it('reports how to enable itself when fixtures are missing', () => {
    expect(available).toBe(true);
  });

  for (const [name, expected] of Object.entries(EXPECTED.clips)) {
    describe(name, () => {
      it('builds a background the animal is not baked into', () => {
        const frames = loadClip(name);
        expect(frames.length).toBeGreaterThan(4);

        const bg = buildBackground(frames);
        expect(bg.width).toBe(frames[0]!.width);

        // The median of frames spread across the recording should be the empty
        // arena. If the animal were baked in, the background would be darker
        // than the platform it is standing on. This is a weak check by design:
        // it catches the failure mode where too few, or too clustered, samples
        // leave a ghost.
        const bright = [...bg.gray].filter((v) => v > 100);
        expect(bright.length).toBeGreaterThan(bg.gray.length * 0.1);
      });

      it('finds the platform', () => {
        const bg = buildBackground(loadClip(name));
        const platform = detectPlatform(bg);
        expect(platform).not.toBeNull();

        // Fixtures are downscaled, so compare in units of frame width rather
        // than pixels. That keeps the expectations valid if the fixture scale
        // changes.
        const cxNorm = platform!.center.x / bg.width;
        const cyNorm = platform!.center.y / bg.height;
        const rNorm = platform!.radius / bg.width;

        expect(cxNorm).toBeCloseTo(expected.centerXNorm, 1);
        expect(cyNorm).toBeCloseTo(expected.centerYNorm, 1);
        expect(rNorm).toBeCloseTo(expected.radiusNorm, 1);
      });

      it('fits a hole ring with real contrast', () => {
        const bg = buildBackground(loadClip(name));
        const platform = detectPlatform(bg)!;
        const ring = detectHoleRing(bg, platform.center, platform.radius, EXPECTED.holeCount);

        expect(ring).not.toBeNull();

        // The ring sits near the rim, not in the middle of the platform.
        const fraction = ring!.ringRadius / platform.radius;
        expect(fraction).toBeGreaterThan(0.75);
        expect(fraction).toBeLessThan(0.98);

        // Contrast score is how much darker the sampled ring points are than
        // mid-grey. A low score means we fitted noise, and the tool warns the
        // user rather than presenting a confident wrong ring.
        expect(ring!.score).toBeGreaterThan(expected.minRingScore);
      });

      it('produces a usable map with notes for the user', () => {
        const bg = buildBackground(loadClip(name));
        const result = detectMaze(bg, EXPECTED.holeCount, 92);

        expect(result.map).not.toBeNull();
        expect(result.map!.holes).toHaveLength(EXPECTED.holeCount);
        // Detection must always explain itself, success or failure.
        expect(result.notes.length).toBeGreaterThan(0);

        // Every hole must land inside the platform. A ring escaping the
        // platform is the visible symptom of a bad circle fit.
        for (const hole of result.map!.holes) {
          const d = Math.hypot(
            hole.center.x - result.map!.platformCenter.x,
            hole.center.y - result.map!.platformCenter.y,
          );
          expect(d).toBeLessThanOrEqual(result.map!.platformRadiusPx);
        }
      });
    });
  }
});

describe.skipIf(available)('evaluation fixtures', () => {
  it('is skipped without fixtures, and says how to add them', () => {
    // Not a failure. Most people cloning this repo will not have the sample
    // videos, and CI does not.
    expect(available).toBe(false);
    console.log(
      'Detection evaluation skipped. To enable it, clone the sample data and run:\n' +
        '  ./scripts/make-fixtures.sh /path/to/rse-takehome-2026/data/barnes-maze',
    );
  });
});
