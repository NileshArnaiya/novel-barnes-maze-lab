import { distance } from '../core/geometry';
import type { MazeMap, Point, TrackPoint, TrackState } from '../core/types';
import type { Blob } from './blob';

/**
 * Deciding what a disappearance means.
 *
 * When the blob detector returns nothing, three very different things may have
 * happened, and they are indistinguishable from the pixels of that one frame:
 *
 *   1. the animal went down a hole (a behaviour we want to measure)
 *   2. the animal went down the target hole (the escape, the key event)
 *   3. tracking failed (a measurement problem)
 *
 * Getting this wrong is the most damaging error the tool can make, because it
 * is silent. Interpolating case 3 produces a smooth, confident, wrong
 * trajectory; misreading case 1 as case 2 produces a wrong escape latency for
 * an animal that never escaped.
 *
 * We resolve it with the only evidence available: where the animal was
 * immediately before it vanished, and whether it stayed vanished.
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
 * Resolve every disappearance in a track.
 *
 * Runs as a second pass over the raw detections, because the decision needs to
 * look forward: whether an absence is an escape depends on how long it lasts,
 * which the frame itself cannot tell you. A single forward pass that guessed
 * immediately would have to revise itself, and revisions are exactly where
 * silent errors hide.
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
    // Which hole was the animal closest to when we last saw it?
    let nearest: { isTarget: boolean; d: number } | null = null;
    for (const hole of map.holes) {
      const d = distance(hole.center, p.lastSeen);
      if (nearest === null || d < nearest.d) nearest = { isTarget: hole.isTarget, d };
    }

    // Not near any hole, or not absent for long enough. This is a genuine
    // tracking failure and we say so. The frames stay `lost`, no position is
    // invented, and quality.ts will surface it for human review.
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

    // Absent. Start or extend a pending disappearance.
    if (pending) {
      pending.frames++;
    } else if (lastSeen) {
      pending = { startIndex: i, lastSeen, frames: 1 };
    }
    // If we have never seen the animal, there is no evidence to reason from,
    // so the frame stays `lost`. This is the correct answer for a trial that
    // starts with the animal still under the start cylinder.
  }

  if (pending) commit(pending);
  return states;
}

/**
 * Decide which end of the animal is the nose.
 *
 * The principal axis gives two candidate endpoints but no sense of which is
 * front. Rodents move nose-first, so the endpoint that is further along the
 * direction of travel is the nose. When the animal is nearly stationary there
 * is no direction of travel and therefore no evidence, so we return null rather
 * than guessing, and every measure that needs a nose falls back to the centroid
 * and says so.
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
 * Median filter over the trajectory.
 *
 * Median rather than mean because a single bad detection is an outlier, and a
 * mean would drag the whole neighbourhood toward it. Lost frames are not
 * smoothed and do not contribute: a filter that averaged across a gap would
 * quietly manufacture a position inside it, which is precisely the failure this
 * whole module exists to prevent.
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
