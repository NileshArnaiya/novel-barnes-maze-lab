import { distance, pxToCm, ringDistance } from './geometry';
import { MIN_DISPLACEMENT_CM, targetQuadrantTimeS, thigmotaxisFraction } from './measures';
import type {
  MazeEvent,
  MazeMap,
  StrategyResult,
  TrackPoint,
} from './types';

/**
 * Rule-based search strategy: spatial / serial / random.
 *
 * No trained model. Reasons are listed so the label can be overridden.
 * Serial is checked first — a walk around the ring can look direct by luck.
 */

export interface StrategyThresholds {
  /** Directness above this counts as a directed route. */
  spatialDirectness: number;
  /** At or below this many non-target holes, the search was targeted. */
  spatialMaxHoles: number;
  /** Minimum run of ring-adjacent holes to call a search serial. */
  serialMinRun: number;
  /** Target-quadrant occupancy that counts as a concentrated search. */
  spatialQuadrantFraction: number;
}

/**
 * 0.45 is roughly "went about twice the straight-line distance".
 * 0.65 was too strict — real animals curve and pause.
 */
export const DEFAULT_STRATEGY_THRESHOLDS: StrategyThresholds = {
  spatialDirectness: 0.45,
  spatialMaxHoles: 3,
  serialMinRun: 4,
  spatialQuadrantFraction: 0.4,
};

/**
 * Longest run of neighbouring holes on the ring. Direction may flip;
 * animals working the ring often back up one hole.
 */
export function longestSerialRun(
  investigations: readonly MazeEvent[],
  holeCount: number,
): number {
  const indices = investigations
    .filter((e) => e.kind === 'investigation' && e.holeIndex !== null)
    .map((e) => e.holeIndex as number);

  if (indices.length === 0) return 0;

  let best = 1;
  let current = 1;
  for (let i = 1; i < indices.length; i++) {
    const a = indices[i - 1];
    const b = indices[i];
    if (a === undefined || b === undefined) continue;
    if (ringDistance(a, b, holeCount) === 1) {
      current++;
      if (current > best) best = current;
    } else {
      current = 1;
    }
  }
  return best;
}

/**
 * Straight-line distance to target / path travelled, up to first reach.
 * 1 is a beeline. Measured only until reach so later wandering does not count.
 */
export function pathDirectness(
  track: readonly TrackPoint[],
  map: MazeMap,
  reachedFrame: number | null,
): number {
  const target = map.holes.find((h) => h.isTarget);
  if (!target) return 0;

  const first = track.find((p) => p.state === 'tracked' && p.body);
  if (!first || !first.body) return 0;

  const end = reachedFrame ?? Number.POSITIVE_INFINITY;

  // Same noise floor as path length, or pauses look like wandering.
  let travelledCm = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (!a || !b) continue;
    if (b.frame > end) break;
    if (a.state !== 'tracked' || b.state !== 'tracked') continue;
    if (!a.body || !b.body) continue;
    const step = pxToCm(map, distance(a.body, b.body));
    if (step < MIN_DISPLACEMENT_CM) continue;
    travelledCm += step;
  }
  if (travelledCm <= 0) return 0;

  const straightCm = pxToCm(map, distance(first.body, target.center));
  // Smoothing can make a beeline look slightly shorter than the straight line.
  return Math.min(1, straightCm / travelledCm);
}

/** Classify one trial. Pure; explains itself in `reasoning`. */
export function classifyStrategy(
  track: readonly TrackPoint[],
  events: readonly MazeEvent[],
  map: MazeMap,
  thresholds: StrategyThresholds = DEFAULT_STRATEGY_THRESHOLDS,
): StrategyResult {
  const investigations = events.filter((e) => e.kind === 'investigation');
  const reached = events.find((e) => e.kind === 'reached-target') ?? null;

  const nonTargetHoles = new Set(
    investigations.filter((e) => !e.isTargetHole).map((e) => e.holeId),
  ).size;

  const directness = pathDirectness(track, map, reached?.startFrame ?? null);
  const serialRun = longestSerialRun(investigations, map.holes.length);
  const thigmo = thigmotaxisFraction(track, map);

  const trialDuration =
    track.length > 0 ? (track[track.length - 1]?.t ?? 0) - (track[0]?.t ?? 0) : 0;
  const quadFraction =
    trialDuration > 0 ? targetQuadrantTimeS(track, map) / trialDuration : 0;

  const features = {
    holesVisitedBeforeTarget: nonTargetHoles,
    pathDirectness: directness,
    longestSerialRun: serialRun,
    targetQuadrantFraction: quadFraction,
    thigmotaxisFraction: thigmo,
  };

  const reasoning: string[] = [];

  // Nothing to classify.
  if (investigations.length === 0 && !reached) {
    return {
      label: 'undetermined',
      confidence: 0,
      reasoning: [
        'No hole investigations and no target arrival were detected, so there is no search to classify.',
        'Check the tracking quality and the investigation thresholds before trusting this trial.',
      ],
      features,
      provenance: 'auto',
    };
  }

  // Serial first: a ring-walk that starts near the target can look spatial.
  if (serialRun >= thresholds.serialMinRun) {
    reasoning.push(
      `Investigated ${serialRun} neighbouring holes in a row, which is the signature of a serial search around the ring.`,
    );
    reasoning.push(
      `Visited ${nonTargetHoles} non-target holes in total.`,
    );
    reasoning.push(
      'Serial search finds the target without needing spatial memory, so a short latency here should not be read as good learning.',
    );
    const confidence = Math.min(
      1,
      0.55 + (serialRun - thresholds.serialMinRun) * 0.1,
    );
    return { label: 'serial', confidence, reasoning, features, provenance: 'auto' };
  }

  // Spatial: a direct route, or a search concentrated in the target quadrant.
  // Requiring both missed cautious animals that still used memory.
  const directRoute =
    directness >= thresholds.spatialDirectness && nonTargetHoles <= thresholds.spatialMaxHoles;
  const concentratedSearch =
    nonTargetHoles <= thresholds.spatialMaxHoles &&
    quadFraction >= thresholds.spatialQuadrantFraction &&
    reached !== undefined;

  if (directRoute || concentratedSearch) {
    if (directRoute) {
      reasoning.push(
        `Path directness was ${directness.toFixed(2)}, at or above the ${thresholds.spatialDirectness} needed to call the route directed.`,
      );
    } else {
      reasoning.push(
        `The route was not a straight line (directness ${directness.toFixed(2)}), but the search was concentrated: ${(quadFraction * 100).toFixed(0)}% of the trial was spent in the target quadrant, which is where spatial memory shows up when an animal is cautious.`,
      );
    }
    reasoning.push(
      `Only ${nonTargetHoles} non-target hole${nonTargetHoles === 1 ? ' was' : 's were'} investigated before reaching the target, below the ${thresholds.spatialMaxHoles} that would suggest an undirected search.`,
    );
    reasoning.push(
      `Longest run of neighbouring holes was ${serialRun}, so this was not a walk around the ring.`,
    );
    const confidence = Math.min(1, 0.45 + Math.max(directness, quadFraction) * 0.5);
    return { label: 'spatial', confidence, reasoning, features, provenance: 'auto' };
  }

  reasoning.push(
    `Path directness was ${directness.toFixed(2)}, below the ${thresholds.spatialDirectness} needed to call the route direct.`,
  );
  reasoning.push(
    `Only ${(quadFraction * 100).toFixed(0)}% of the trial was spent in the target quadrant, below the ${(thresholds.spatialQuadrantFraction * 100).toFixed(0)}% that would indicate a concentrated search.`,
  );
  reasoning.push(
    `Longest run of neighbouring holes was ${serialRun}, below the ${thresholds.serialMinRun} needed to call it serial.`,
  );
  reasoning.push(
    `Investigated ${nonTargetHoles} non-target holes.`,
  );
  if (thigmo > 0.5) {
    reasoning.push(
      `Spent ${(thigmo * 100).toFixed(0)}% of visible time against the platform edge. Heavy thigmotaxis is an anxiety signal and can look like poor memory in the latency and error counts.`,
    );
  }

  // Random is the leftover bin; keep confidence modest.
  return {
    label: 'random',
    confidence: 0.5,
    reasoning,
    features,
    provenance: 'auto',
  };
}
