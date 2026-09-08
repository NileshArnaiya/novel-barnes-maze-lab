import type { Hole, MazeMap, Point } from './types';

/** Euclidean distance between two points, in whatever units they are in. */
export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Pixels per centimetre from the platform diameter the user typed. */
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
 * Angle around the platform, radians, 0..2π, counter-clockwise from +x.
 * Image y grows down, so dy is negated.
 */
export function angleAround(center: Point, p: Point): number {
  const a = Math.atan2(-(p.y - center.y), p.x - center.x);
  return a < 0 ? a + 2 * Math.PI : a;
}

/**
 * Quadrant 0 is centred on the target hole, not the image axes.
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

/** Shortest distance around the ring. Holes 0 and 19 are neighbours on a 20-hole maze. */
export function ringDistance(a: number, b: number, holeCount: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, holeCount - raw);
}

/**
 * Least-squares circle (Kåsa). Needs at least 3 points. Short arcs bias small.
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

  // Centre the coordinates so the linear system is stable.
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

/** Evenly spaced holes. `startAngle` is where hole 0 sits. */
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
 * Copy a map onto another video by translating and scaling the platform.
 * Rotation is not guessed — that would renumber the escape hole.
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

  // A big scale change means the two videos were not filmed the same way.
  const scaleDeviation = Math.abs(1 - scale);
  const registrationScore = Math.max(0, 1 - scaleDeviation * 4);

  return {
    platformCenter: targetCenter,
    platformRadiusPx: targetRadiusPx,
    platformDiameterCm: source.platformDiameterCm,
    holes,
    origin: 'registered',
    registrationScore,
    // Escape hole carries over; re-mark it if this rig is different.
    targetConfirmed: source.targetConfirmed,
  };
}

/**
 * Twist the ring. Hole indices and the target flag stay put.
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
