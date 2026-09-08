import { buildHoleRing, fitCircle } from '../core/geometry';
import type { MazeMap, Point } from '../core/types';
import type { Frame } from './blob';

/**
 * Detect the platform circle and a ring of evenly spaced holes.
 * Fitted as that known model, not a general circle hunt.
 */

export interface DetectionResult {
  map: MazeMap | null;
  /** Shown either way, including on failure. */
  notes: string[];
}

/**
 * Brightest large region → circle. Typical footage: pale platform on a dark surround.
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

  // Leftmost and rightmost bright pixel per sampled row.
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
    // Short runs are noise, not the platform.
    if (left >= 0 && right - left > width * 0.1) {
      boundary.push({ x: left, y }, { x: right, y });
    }
  }

  if (boundary.length < 12) return null;
  return fitCircle(boundary);
}

/**
 * Darkest evenly spaced samples around candidate rings. Fits the whole ring
 * at once, so a couple of hidden holes do not sink it.
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

  // Holes sit near the rim. Upper bound 0.97 so a slightly tight platform fit
  // does not push the real ring (~0.925) out of the search.
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
      // Darker samples → better ring.
      const score = 255 - sum / holeCount;
      if (!best || score > best.score) best = { ringRadius, startAngle, score };
    }
  }

  return best;
}

/** Always returns notes, including when it fails. */
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

  // Low contrast: we probably fitted noise. Say so.
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
