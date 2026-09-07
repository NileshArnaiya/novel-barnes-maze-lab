import { buildHoleRing, fitCircle } from '../core/geometry';
import type { MazeMap, Point } from '../core/types';
import type { Frame } from './blob';

/**
 * Automatic detection of the platform and its holes.
 *
 * This is the single biggest usability lever in the tool. Twenty holes across
 * sixty videos is roughly 1200 clicks if done by hand. Detecting the platform
 * and fitting a ring model to it turns that into "confirm, then apply to the
 * rest of the cohort".
 *
 * We do not attempt a general circle detector. We fit a model we already know
 * is correct: one platform circle, and one ring of evenly spaced holes inside
 * it. Fitting a known model to noisy data is far more reliable than searching
 * for arbitrary circles, and when it fails it fails in ways a user can see and
 * correct rather than in ways that look plausible.
 */

export interface DetectionResult {
  map: MazeMap | null;
  /** Plain-language account of what happened, shown in the UI either way. */
  notes: string[];
}

/**
 * Find the platform by locating the brightest large region.
 *
 * Typical Barnes maze footage is a pale circular platform on a darker
 * surround. We threshold at a high percentile of the frame's brightness,
 * take the centroid and extent of what survives, and fit a circle to its
 * boundary points.
 */
export function detectPlatform(
  frame: Frame,
  brightPercentile = 0.6,
): { center: Point; radius: number } | null {
  const { gray, width, height } = frame;

  // Percentile threshold via a 256-bin histogram: one pass, no sorting.
  const hist = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i] ?? 0] = (hist[gray[i] ?? 0] ?? 0) + 1;
  const target = gray.length * brightPercentile;
  let cum = 0;
  let threshold = 128;
  for (let v = 0; v < 256; v++) {
    cum += hist[v] ?? 0;
    if (cum >= target) {
      threshold = v;
      break;
    }
  }

  // Boundary points: for each row, the leftmost and rightmost bright pixel.
  // Sampling rows rather than every pixel keeps this fast and gives the circle
  // fit a well-distributed set of points around the edge.
  const boundary: Point[] = [];
  const rowStep = Math.max(1, Math.floor(height / 60));
  for (let y = 0; y < height; y += rowStep) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) {
      if ((gray[y * width + x] ?? 0) >= threshold) {
        if (left < 0) left = x;
        right = x;
      }
    }
    // Skip rows with a very short run: those are noise, not the platform.
    if (left >= 0 && right - left > width * 0.1) {
      boundary.push({ x: left, y }, { x: right, y });
    }
  }

  if (boundary.length < 12) return null;
  return fitCircle(boundary);
}

/**
 * Locate the ring of holes.
 *
 * Holes are dark spots at a fixed radius from the centre. Rather than finding
 * each one independently, we sample brightness around candidate rings and pick
 * the ring radius and rotation whose sampled points are darkest. This finds all
 * twenty at once and is robust to two or three holes being obscured, because
 * the model is fitted to the whole ring rather than to individual detections.
 */
export function detectHoleRing(
  frame: Frame,
  center: Point,
  platformRadius: number,
  holeCount: number,
): { ringRadius: number; startAngle: number; score: number } | null {
  const { gray, width, height } = frame;

  const sample = (p: Point): number => {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= width || y >= height) return 255;
    return gray[y * width + x] ?? 255;
  };

  let best: { ringRadius: number; startAngle: number; score: number } | null = null;

  // Holes sit near the rim. Search the outer band of the platform radius.
  // The upper bound is 0.97 rather than 0.95 because on the sample footage the
  // real ring sits at about 0.925 of the fitted radius, close enough to the old
  // bound that a slightly tighter circle fit would have pushed it outside the
  // search and produced a confidently wrong ring.
  for (let rf = 0.7; rf <= 0.97; rf += 0.005) {
    const ringRadius = platformRadius * rf;
    const angleStep = (2 * Math.PI) / holeCount;

    for (let k = 0; k < 24; k++) {
      const startAngle = (k / 24) * angleStep;
      let sum = 0;
      for (let i = 0; i < holeCount; i++) {
        const a = startAngle + i * angleStep;
        sum += sample({
          x: center.x + ringRadius * Math.cos(a),
          y: center.y - ringRadius * Math.sin(a),
        });
      }
      // Lower mean brightness means we landed on more dark holes.
      const score = 255 - sum / holeCount;
      if (!best || score > best.score) best = { ringRadius, startAngle, score };
    }
  }

  return best;
}

/**
 * Full auto-detection. Always returns notes, including on failure, because
 * "it did not work" with a reason is more useful than a silent fallback to
 * manual mode.
 */
export function detectMaze(
  frame: Frame,
  holeCount: number,
  platformDiameterCm: number,
): DetectionResult {
  const notes: string[] = [];

  const platform = detectPlatform(frame);
  if (!platform) {
    notes.push('Could not find the platform edge. Draw it by dragging on the frame.');
    return { map: null, notes };
  }
  notes.push(
    `Platform found at (${platform.center.x.toFixed(0)}, ${platform.center.y.toFixed(0)}) with radius ${platform.radius.toFixed(0)} px.`,
  );

  const ring = detectHoleRing(frame, platform.center, platform.radius, holeCount);
  if (!ring) {
    notes.push('Could not fit a hole ring. Place the holes manually.');
    return { map: null, notes };
  }

  // A low contrast score means the sampled ring points were not much darker
  // than the platform, so we probably fitted noise. Say so rather than
  // presenting a confident wrong ring.
  if (ring.score < 40) {
    notes.push(
      `Hole ring contrast is low (score ${ring.score.toFixed(0)}). Check the ring position before continuing.`,
    );
  } else {
    notes.push(`Fitted a ${holeCount}-hole ring at ${(ring.ringRadius / platform.radius * 100).toFixed(0)}% of the platform radius.`);
  }

  notes.push('Click the escape hole to mark it as the target.');

  return {
    map: {
      platformCenter: platform.center,
      platformRadiusPx: platform.radius,
      platformDiameterCm,
      holes: buildHoleRing(platform.center, ring.ringRadius, holeCount, ring.startAngle, 0),
      origin: 'auto-detected',
    },
    notes,
  };
}
