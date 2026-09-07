import { distance, pxToCm, ringDistance } from './geometry';
import { MIN_DISPLACEMENT_CM, targetQuadrantTimeS, thigmotaxisFraction } from './measures';
import type {
  MazeEvent,
  MazeMap,
  StrategyResult,
  TrackPoint,
} from './types';

/**
 * Search strategy classification.
 *
 * Strategy is the sensitive readout in the Barnes maze: two animals can share a
 * latency while searching in completely different ways, and the difference is
 * what distinguishes hippocampal spatial memory from a non-spatial workaround.
 * Historically it is scored by eye, which is slow and drifts between raters.
 *
 * The principled automated version is BUNS, which trains a support vector
 * machine on trajectory features (Illouz et al., Bioinformatics 2016,
 * 32(21):3314). We deliberately do not ship a trained model. A model shipped
 * without its training set is a black box a user cannot audit, and this tool's
 * whole argument is that the user must be able to see why a number came out.
 *
 * So this is a transparent rule-based classifier over the same feature family.
 * It states its evidence, it reports a confidence, and the user can override
 * the label. An override is recorded as a human decision, not as a correction
 * to the algorithm.
 *
 * The three canonical strategies:
 *   spatial - goes more or less directly to the target
 *   serial  - works around the ring hole by hole until it finds the target
 *   random  - crosses the platform repeatedly with no systematic pattern
 */

export interface StrategyThresholds {
  /** Above this directness a trajectory counts as direct. */
  spatialDirectness: number;
  /** At or below this many non-target holes, the search was targeted. */
  spatialMaxHoles: number;
  /** Minimum run of ring-adjacent holes to call a search serial. */
  serialMinRun: number;
  /** Target-quadrant occupancy that counts as a concentrated search. */
  spatialQuadrantFraction: number;
}

/**
 * Directness of 0.65 was the first guess and it was too strict. A real animal
 * that heads to the target still curves, pauses, and corrects, so demanding
 * two thirds of a perfect beeline classified genuinely spatial trials as
 * random. 0.45 is roughly "went about twice as far as the straight line",
 * which is what a directed approach actually looks like on video.
 *
 * This is a threshold, not a fact, which is why it is here and adjustable
 * rather than inline in the classifier.
 */
export const DEFAULT_STRATEGY_THRESHOLDS: StrategyThresholds = {
  spatialDirectness: 0.45,
  spatialMaxHoles: 3,
  serialMinRun: 4,
  spatialQuadrantFraction: 0.4,
};

/**
 * Longest run of consecutively investigated holes that are neighbours on the
 * ring. A serial searcher produces a long run; a spatial searcher produces
 * almost none.
 *
 * Direction is allowed to flip, because a real animal working round the ring
 * will sometimes double back a hole and continue. Requiring a single direction
 * would classify most genuine serial searches as random.
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
 * Path directness: straight-line distance from start to target, divided by
 * distance actually travelled to get there. 1.0 is a perfect beeline, values
 * near 0 mean a long wandering route.
 *
 * Measured only up to the moment the target is first reached. Including the
 * whole trial would penalise an animal that found the target quickly and then
 * explored, which is not what the measure is for.
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

  // Same noise floor as path length. Without it, an animal that pauses to
  // investigate a hole accumulates jitter that looks like wandering, and a
  // perfectly direct route scores as random.
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
  // Cap at 1: floating point and smoothing can make a beeline look slightly
  // shorter than the straight line, and a directness above 1 is meaningless.
  return Math.min(1, straightCm / travelledCm);
}

/** Classify one trial. Pure, deterministic, and explains itself. */
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

  // Nothing to classify. Saying so is more useful than picking a label.
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

  // Serial is checked before spatial. An animal that works round the ring and
  // happens to start next to the target can look direct, and calling that
  // spatial would overstate its memory.
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

  /**
   * Spatial search has two signatures, and requiring both was the bug.
   *
   * The obvious one is a direct route: high path directness with few errors.
   * The second is a concentrated search: an animal that goes to the right
   * region of the platform and checks two or three holes there has used
   * spatial memory even though its path is not a straight line. Quadrant
   * occupancy is the standard index for exactly that, and it is what a human
   * rater is using when they call such a trial spatial by eye.
   *
   * Requiring high directness AND few errors classified the second kind as
   * random, which understates learning in precisely the animals that have
   * learned but are cautious.
   */
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

  // Confidence in "random" is deliberately capped. Random is the residual
  // category, and a residual is weaker evidence than a positive match.
  return {
    label: 'random',
    confidence: 0.5,
    reasoning,
    features,
    provenance: 'auto',
  };
}
