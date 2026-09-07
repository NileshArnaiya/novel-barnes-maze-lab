import { distance, isNearEdge, pxToCm, quadrantOf } from './geometry';
import type {
  MazeEvent,
  MazeMap,
  ScoringParams,
  TrackPoint,
  TrialType,
} from './types';

/**
 * The measures a scientist reports. Every function here is pure and takes the
 * events and track it needs, so each one can be tested against a synthetic
 * trajectory with a known answer.
 *
 * Definitions and their sources are in docs/measures.md. Where the literature
 * disagrees the disagreement is documented rather than resolved silently.
 */

/**
 * Time to first reach the target hole.
 *
 * Null means "never reached", which is different from zero and different from
 * the trial timeout. Callers decide how to present it; the export writes an
 * empty cell plus an explicit `reached_target` boolean column so a downstream
 * analysis cannot mistake a censored value for a fast one.
 */
export function primaryLatency(events: readonly MazeEvent[]): number | null {
  const reached = events.find((e) => e.kind === 'reached-target');
  return reached ? reached.startT : null;
}

/**
 * Time to enter the escape box.
 *
 * Undefined on probe trials by construction: there is no escape box to enter.
 */
export function totalLatency(
  events: readonly MazeEvent[],
  trialType: TrialType,
): number | null {
  if (trialType === 'probe') return null;
  const escape = events.find((e) => e.kind === 'escape');
  return escape ? escape.startT : null;
}

/**
 * Errors before the animal first reaches the target.
 *
 * Counted as distinct non-target holes investigated, not as total
 * investigations: returning to the same wrong hole twice is one error under the
 * most common convention. `docs/measures.md` records that some papers count
 * every visit instead, and the export labels which convention was used.
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
 * Minimum frame-to-frame displacement counted as real movement.
 *
 * A stationary animal still produces a centroid that jitters by a pixel or two
 * every frame, from sensor noise and from the blob's edge flickering. Summing
 * that raw gives a mouse sitting perfectly still a path length of metres, and
 * at 30 frames per second a few seconds of grooming can out-weigh a real
 * traverse of the platform.
 *
 * Every serious tracker has this filter; EthoVision calls it minimum distance
 * moved. Without it, path length measures tracking noise as much as behaviour,
 * and any measure derived from it, path directness in particular, is wrong in
 * a way that looks plausible.
 *
 * Set in centimetres so it means the same thing on every rig regardless of
 * camera height.
 */
export const MIN_DISPLACEMENT_CM = 0.4;

/**
 * Distance travelled, in centimetres.
 *
 * Only consecutive pairs of frames where the animal was actually visible
 * contribute. A gap is skipped, not bridged: bridging a five-second occlusion
 * with a straight line adds distance the animal may never have travelled, and
 * that error compounds across a cohort. Skipping instead under-reports, which
 * is the safer direction and is disclosed via `trackedFraction`.
 *
 * Displacements below MIN_DISPLACEMENT_CM are treated as noise, not movement.
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
 * Mean speed while moving, cm/s.
 *
 * Averaging over the whole trial conflates "moved slowly" with "sat still for a
 * long time", which are different behaviours. We average only over frames above
 * a small movement floor, and report the floor in the export.
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
 * Seconds spent in the quadrant containing the target hole.
 *
 * The standard probe-trial readout: an animal that remembers the location
 * concentrates its search there. Frames where the animal is not visible are
 * excluded from the numerator, so a badly tracked trial reports less quadrant
 * time rather than a fabricated amount.
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

/**
 * Fraction of visible time spent hugging the platform edge.
 *
 * Thigmotaxis is an anxiety readout, not a memory one, but it looks like poor
 * performance in latency and error counts. Surfacing it separately stops an
 * anxious animal being scored as a forgetful one.
 */
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
 * Fraction of frames where the animal's position was genuinely observed.
 *
 * Frames inside a hole count as observed: we know exactly where the animal is,
 * it is simply not visible. Only `lost` counts against the score. This is the
 * number that tells a user whether to trust everything above it.
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

/**
 * Latency to report when the animal never escaped.
 *
 * Two conventions exist: assign the trial timeout, or exclude the trial. We
 * assign the timeout and mark it, because silently dropping trials biases group
 * means toward the animals that learned.
 */
export function censoredLatency(
  latency: number | null,
  params: ScoringParams,
): { value: number; censored: boolean } {
  if (latency === null) return { value: params.trialTimeoutS, censored: true };
  return { value: latency, censored: false };
}
