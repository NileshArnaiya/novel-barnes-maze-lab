import { distance } from '../core/geometry';
import type { MazeMap, Point, TrackPoint, TrackState } from '../core/types';
import type { Blob } from './blob';

/**
 * What a missing blob means: hole, target hole, or lost.
 *
 * One frame cannot tell. We use last seen position and how long it stayed gone.
 * Interpolating a loss invents a path; calling the wrong hole invents an escape.
 */

export interface OcclusionConfig {
  /** How close to a hole the last sighting must be, in pixels. */
  holeProximityPx: number;
  /** Frames of continued absence needed to commit to an in-hole call. */
  confirmFrames: number;
}

interface Pending {
  startIndex: number;
  lastSeen: Point;
  frames: number;
}

/**
 * Second pass over detections. Needs to look forward: an escape is "stayed gone".
 */
export function resolveOcclusions(
  raw: readonly (Blob | null)[],
  map: MazeMap,
  config: OcclusionConfig,
): TrackState[] {
  const states: TrackState[] = new Array(raw.length).fill('lost');
  let lastSeen: Point | null = null;
  let pending: Pending | null = null;

  const commit = (p: Pending) => {
    // Closest hole to last sighting.
    let nearest: { isTarget: boolean; d: number } | null = null;
    for (const hole of map.holes) {
      const d = distance(hole.center, p.lastSeen);
      if (nearest === null || d < nearest.d) nearest = { isTarget: hole.isTarget, d };
    }

    // Not near a hole, or not gone long enough → lost. No invented position.
    if (!nearest || nearest.d > config.holeProximityPx) return;
    if (p.frames < config.confirmFrames) return;

    const state: TrackState = nearest.isTarget ? 'in-target-hole' : 'in-other-hole';
    for (let i = p.startIndex; i < p.startIndex + p.frames; i++) states[i] = state;
  };

  for (let i = 0; i < raw.length; i++) {
    const blob = raw[i];

    if (blob) {
      if (pending) {
        commit(pending);
        pending = null;
      }
      states[i] = 'tracked';
      lastSeen = blob.centroid;
      continue;
    }

    // Absent. Start or extend a pending gap.
    if (pending) {
      pending.frames++;
    } else if (lastSeen) {
      pending = { startIndex: i, lastSeen, frames: 1 };
    }
    // Never seen the animal yet (still under the start cylinder) → lost.
  }

  if (pending) commit(pending);
  return states;
}

/**
 * Nose = the endpoint further along the direction of travel.
 * Stationary → null, then measures fall back to the centroid.
 */
export function resolveNose(
  blob: Blob,
  previousCentroid: Point | null,
  minDisplacementPx = 1.5,
): Point | null {
  if (!previousCentroid) return null;

  const vx = blob.centroid.x - previousCentroid.x;
  const vy = blob.centroid.y - previousCentroid.y;
  if (Math.hypot(vx, vy) < minDisplacementPx) return null;

  const projA = (blob.extremeA.x - blob.centroid.x) * vx + (blob.extremeA.y - blob.centroid.y) * vy;
  const projB = (blob.extremeB.x - blob.centroid.x) * vx + (blob.extremeB.y - blob.centroid.y) * vy;

  return projA > projB ? blob.extremeA : blob.extremeB;
}

/**
 * Median filter. Lost frames are skipped and never filled in.
 */
export function smoothTrack(track: TrackPoint[], windowFrames: number): TrackPoint[] {
  if (windowFrames <= 1) return track;
  const half = Math.floor(windowFrames / 2);

  return track.map((p, i) => {
    if (p.state !== 'tracked' || !p.body) return p;

    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(track.length - 1, i + half); j++) {
      const q = track[j];
      if (q && q.state === 'tracked' && q.body) {
        xs.push(q.body.x);
        ys.push(q.body.y);
      }
    }
    if (xs.length === 0) return p;

    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const mid = xs.length >> 1;

    return {
      ...p,
      body: { x: xs[mid] ?? p.body.x, y: ys[mid] ?? p.body.y },
    };
  });
}
