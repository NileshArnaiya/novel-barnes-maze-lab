import { distance, isNearEdge, pxToCm, quadrantOf } from './geometry';
import type {
  MazeEvent,
  MazeMap,
  ScoringParams,
  TrackPoint,
  TrialType,
} from './types';

/**
 * Trial measures. Pure functions; answers live in docs/measures.md.
 */

/**
 * Time to first reach the target. Null means never reached, not zero.
 */
export function primaryLatency(events: readonly MazeEvent[]): number | null {
  const reached = events.find((e) => e.kind === 'reached-target');
  return reached ? reached.startT : null;
}

/** Time to enter the escape box. Always null on probe trials. */
export function totalLatency(
  events: readonly MazeEvent[],
  trialType: TrialType,
): number | null {
  if (trialType === 'probe') return null;
  const escape = events.find((e) => e.kind === 'escape');
  return escape ? escape.startT : null;
}

/**
 * Distinct non-target holes visited before first reach.
 * Same hole twice still counts as one. Some papers count every visit instead.
 */
export function primaryErrors(events: readonly MazeEvent[]): number {
  const reached = events.find((e) => e.kind === 'reached-target');
  const cutoff = reached ? reached.startT : Infinity;

  const seen = new Set<string>();
  for (const e of events) {
    if (e.kind !== 'investigation') continue;
    if (e.isTargetHole) continue;
    if (e.startT >= cutoff) break;
    if (e.holeId) seen.add(e.holeId);
  }
  return seen.size;
}

/** Distinct non-target holes investigated across the whole trial. */
export function totalErrors(events: readonly MazeEvent[]): number {
  const seen = new Set<string>();
  for (const e of events) {
    if (e.kind !== 'investigation') continue;
    if (e.isTargetHole) continue;
    if (e.holeId) seen.add(e.holeId);
  }
  return seen.size;
}

/**
 * Ignore centroid jitter below this (cm). Without it, a sitting animal
 * accumulates metres of fake path.
 */
export const MIN_DISPLACEMENT_CM = 0.4;

/**
 * Distance travelled, cm. Only consecutive tracked frames. Gaps are skipped,
 * not bridged. Tiny steps below MIN_DISPLACEMENT_CM are noise.
 */
export function pathLengthCm(
  track: readonly TrackPoint[],
  map: MazeMap,
): number {
  let cm = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (!a || !b) continue;
    if (a.state !== 'tracked' || b.state !== 'tracked') continue;
    if (!a.body || !b.body) continue;
    const step = pxToCm(map, distance(a.body, b.body));
    if (step < MIN_DISPLACEMENT_CM) continue;
    cm += step;
  }
  return cm;
}

/**
 * Mean speed while moving, cm/s. Frames below MOVEMENT_FLOOR_CM_S are ignored
 * so sitting still is not averaged in as "slow".
 */
export const MOVEMENT_FLOOR_CM_S = 1.0;

export function meanSpeedCmS(
  track: readonly TrackPoint[],
  map: MazeMap,
): number {
  let sum = 0;
  let n = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (!a || !b) continue;
    if (a.state !== 'tracked' || b.state !== 'tracked') continue;
    if (!a.body || !b.body) continue;
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    const v = pxToCm(map, distance(a.body, b.body)) / dt;
    if (v < MOVEMENT_FLOOR_CM_S) continue;
    sum += v;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Seconds in the target quadrant. Untracked frames add nothing, so a bad
 * track reports less time rather than a made-up amount.
 */
export function targetQuadrantTimeS(
  track: readonly TrackPoint[],
  map: MazeMap,
): number {
  let seconds = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (!a || !b || !a.body) continue;
    if (a.state !== 'tracked') continue;
    if (quadrantOf(map, a.body) === 0) seconds += b.t - a.t;
  }
  return seconds;
}

/** Fraction of visible time spent near the rim. Anxiety, not memory. */
export function thigmotaxisFraction(
  track: readonly TrackPoint[],
  map: MazeMap,
  bandCm = 5,
): number {
  const bandPx = (bandCm * map.platformRadiusPx * 2) / map.platformDiameterCm;
  let near = 0;
  let total = 0;
  for (const p of track) {
    if (p.state !== 'tracked' || !p.body) continue;
    total++;
    if (isNearEdge(map, p.body, bandPx)) near++;
  }
  return total === 0 ? 0 : near / total;
}

/**
 * Fraction of frames that are not `lost`. Time in a hole still counts as known.
 */
export function trackedFraction(track: readonly TrackPoint[]): number {
  if (track.length === 0) return 0;
  let ok = 0;
  for (const p of track) if (p.state !== 'lost') ok++;
  return ok / track.length;
}

export function humanEditedFrames(track: readonly TrackPoint[]): number {
  let n = 0;
  for (const p of track) if (p.provenance === 'human') n++;
  return n;
}

/** If never escaped, use the timeout and mark it censored. */
export function censoredLatency(
  latency: number | null,
  params: ScoringParams,
): { value: number; censored: boolean } {
  if (latency === null) return { value: params.trialTimeoutS, censored: true };
  return { value: latency, censored: false };
}
