import type { Hole, MazeMap, Point } from './types';

/** Euclidean distance between two points, in whatever units they are in. */
export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Pixels per centimetre for this video.
 *
 * Camera height varies between rigs and sometimes between days on the same rig,
 * so this is derived per video from the platform, whose real diameter the user
 * types in. Reporting path length in pixels would make it incomparable across
 * videos and unusable in a paper.
 */
export function pixelsPerCm(map: MazeMap): number {
  return (map.platformRadiusPx * 2) / map.platformDiameterCm;
}

export function pxToCm(map: MazeMap, px: number): number {
  return px / pixelsPerCm(map);
}

export function cmToPx(map: MazeMap, cm: number): number {
  return cm * pixelsPerCm(map);
}

/**
 * Angle of a point around the platform centre, in radians, measured
 * counter-clockwise from the positive x axis. Image y grows downward, so we
 * negate dy to get a conventional maths orientation. Returns 0..2π.
 */
export function angleAround(center: Point, p: Point): number {
  const a = Math.atan2(-(p.y - center.y), p.x - center.x);
  return a < 0 ? a + 2 * Math.PI : a;
}

/**
 * Which quadrant a point falls in, where quadrant 0 is centred on the target
 * hole. Quadrant occupancy is the standard probe-trial readout, and defining it
 * relative to the target rather than to the image axes is what makes it
 * comparable between animals whose target hole differs.
 */
export function quadrantOf(map: MazeMap, p: Point): number {
  const target = map.holes.find((h) => h.isTarget);
  if (!target) return -1;
  const targetAngle = angleAround(map.platformCenter, target.center);
  const pointAngle = angleAround(map.platformCenter, p);
  let rel = pointAngle - targetAngle + Math.PI / 4;
  rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.floor(rel / (Math.PI / 2));
}

/** True if the point lies within `radiusPx` of the platform edge. */
export function isNearEdge(map: MazeMap, p: Point, bandPx: number): boolean {
  const r = distance(map.platformCenter, p);
  return r >= map.platformRadiusPx - bandPx;
}

/**
 * Nearest hole to a point, with its distance in pixels.
 * Returns null when the map has no holes.
 */
export function nearestHole(
  holes: readonly Hole[],
  p: Point,
): { hole: Hole; distPx: number } | null {
  let best: { hole: Hole; distPx: number } | null = null;
  for (const hole of holes) {
    const d = distance(hole.center, p);
    if (best === null || d < best.distPx) best = { hole, distPx: d };
  }
  return best;
}

/**
 * Ring distance between two hole indices, taking the shorter way round.
 * With 20 holes, holes 0 and 19 are adjacent, not 19 apart. Serial-search
 * detection is meaningless without this.
 */
export function ringDistance(a: number, b: number, holeCount: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, holeCount - raw);
}

/**
 * Least-squares circle fit (Kåsa method).
 *
 * Given points on the platform edge, solves for centre and radius by turning
 * the circle equation into a linear system. Cheap, closed-form, and good enough
 * when the points really are on a circle; it biases toward smaller radii when
 * the arc is short, which is why the UI lets the user nudge the result.
 */
export function fitCircle(
  points: readonly Point[],
): { center: Point; radius: number } | null {
  const n = points.length;
  if (n < 3) return null;

  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const mx = sx / n;
  const my = sy / n;

  // Work in centred coordinates for numerical stability.
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;

  for (const p of points) {
    const u = p.x - mx;
    const v = p.y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }

  const det = 2 * (suu * svv - suv * suv);
  if (Math.abs(det) < 1e-9) return null;

  const c1 = suuu + suvv;
  const c2 = svvv + svuu;
  const uc = (svv * c1 - suv * c2) / det;
  const vc = (suu * c2 - suv * c1) / det;

  const radius = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return { center: { x: uc + mx, y: vc + my }, radius };
}

/**
 * Build a ring of evenly spaced holes.
 *
 * Used both by auto-detection (as the model it fits) and by the manual editor,
 * so a user who nudges the ring gets the same representation the detector
 * produces. `startAngle` is where hole 0 sits.
 */
export function buildHoleRing(
  center: Point,
  ringRadiusPx: number,
  count: number,
  startAngle: number,
  targetIndex: number,
): Hole[] {
  const holes: Hole[] = [];
  for (let i = 0; i < count; i++) {
    const a = startAngle + (i * 2 * Math.PI) / count;
    holes.push({
      id: `hole-${i}`,
      index: i,
      isTarget: i === targetIndex,
      center: {
        x: center.x + ringRadiusPx * Math.cos(a),
        y: center.y - ringRadiusPx * Math.sin(a),
      },
    });
  }
  return holes;
}

/**
 * Transfer a maze map from one video to another.
 *
 * Both videos are the same rig filmed from a fixed camera, so the platform
 * moves by at most a small translation and scale between recordings. We solve
 * for that similarity transform from the two platform circles alone, which is
 * why detecting the platform in a new video is enough to place all 20 holes.
 *
 * Rotation is deliberately not estimated: nothing in a top-down circular
 * platform pins down rotation reliably, and guessing it would silently
 * renumber every hole. Instead the transferred map keeps the source ring
 * orientation and the user confirms it. A wrong assumption here would corrupt
 * the target-hole identity, which is the one thing the whole analysis rests on.
 */
export function registerMap(
  source: MazeMap,
  targetCenter: Point,
  targetRadiusPx: number,
): MazeMap {
  const scale = targetRadiusPx / source.platformRadiusPx;

  const holes = source.holes.map((h) => ({
    ...h,
    center: {
      x: targetCenter.x + (h.center.x - source.platformCenter.x) * scale,
      y: targetCenter.y + (h.center.y - source.platformCenter.y) * scale,
    },
  }));

  // Score how believable the transfer is. A large scale change means the two
  // videos were not filmed the same way and the user should look at it.
  const scaleDeviation = Math.abs(1 - scale);
  const registrationScore = Math.max(0, 1 - scaleDeviation * 4);

  return {
    platformCenter: targetCenter,
    platformRadiusPx: targetRadiusPx,
    platformDiameterCm: source.platformDiameterCm,
    holes,
    origin: 'registered',
    registrationScore,
    // The target choice does carry over: the escape hole is in the same
    // physical place across a cohort filmed on one rig. If it is not, the user
    // is expected to re-mark it, which the review step prompts for.
    targetConfirmed: source.targetConfirmed,
  };
}

/**
 * Rotate hole positions around the platform centre.
 *
 * Used when the user twists the ring to match the holes in the footage.
 * Indices and the target flag stay put: rotating the drawing must not
 * silently renumber the escape hole, because every target-relative measure
 * depends on which hole is the target.
 */
export function rotateMap(map: MazeMap, deltaRad: number): MazeMap {
  if (deltaRad === 0) return map;
  const c = map.platformCenter;
  const cos = Math.cos(deltaRad);
  const sin = Math.sin(deltaRad);
  return {
    ...map,
    holes: map.holes.map((h) => {
      const dx = h.center.x - c.x;
      const dy = h.center.y - c.y;
      return {
        ...h,
        center: {
          x: c.x + dx * cos + dy * sin,
          y: c.y - dx * sin + dy * cos,
        },
      };
    }),
  };
}
