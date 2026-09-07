import { detectAllEvents } from './events';
import {
  humanEditedFrames,
  meanSpeedCmS,
  pathLengthCm,
  primaryErrors,
  primaryLatency,
  targetQuadrantTimeS,
  totalErrors,
  totalLatency,
  trackedFraction,
} from './measures';
import { classifyStrategy } from './strategy';
import type {
  MazeEvent,
  MazeMap,
  ScoringParams,
  TrackPoint,
  TrialSummary,
  VideoRecord,
} from './types';

/**
 * One place where a track plus a map plus parameters becomes a scored trial.
 *
 * Keeping this as a single pure function is what makes the parameter sweep
 * possible: the sensitivity view just calls it in a loop with different
 * thresholds. It is also the only thing the UI needs to call when a user drags
 * a slider or edits a frame.
 */
export function analyze(
  video: VideoRecord,
  track: readonly TrackPoint[],
  map: MazeMap,
  params: ScoringParams,
): { events: MazeEvent[]; summary: TrialSummary } {
  const events = detectAllEvents(track, map, params, video.trialType);
  const auto = classifyStrategy(track, events, map);

  // A human override replaces the label but keeps the evidence, so a reviewer
  // can still see what the classifier thought. The override is honoured even
  // when it matches the automatic label: a person confirming the classifier is
  // a real decision worth recording as human, and dropping it when the two
  // agreed made the dropdown look like it did nothing whenever the user picked
  // the label already showing.
  const strategy = video.strategyOverride
    ? {
        ...auto,
        label: video.strategyOverride,
        provenance: 'human' as const,
        confidence: 1,
        reasoning: [
          video.strategyOverride === auto.label
            ? `Confirmed as ${video.strategyOverride} by a person; the classifier had chosen the same label.`
            : `Set to ${video.strategyOverride} by a person, overriding the automatic label of ${auto.label}.`,
          'The automatic reasoning is kept below for reference.',
          ...auto.reasoning,
        ],
      }
    : auto;

  const summary: TrialSummary = {
    videoId: video.id,
    animalId: video.animalId,
    cohort: video.cohort,
    day: video.day,
    trialType: video.trialType,
    primaryLatencyS: primaryLatency(events),
    totalLatencyS: totalLatency(events, video.trialType),
    primaryErrors: primaryErrors(events),
    totalErrors: totalErrors(events),
    pathLengthCm: pathLengthCm(track, map),
    meanSpeedCmS: meanSpeedCmS(track, map),
    targetQuadrantTimeS: targetQuadrantTimeS(track, map),
    strategy,
    trackedFraction: trackedFraction(track),
    humanEditedFrames: humanEditedFrames(track),
  };

  return { events, summary };
}

/**
 * Threshold sensitivity sweep.
 *
 * In six months someone will ask why two cohorts disagree, and the answer will
 * often be a threshold. Rather than only recording the threshold we used, this
 * shows how the result moves as it changes, which turns an arbitrary choice
 * into a documented robustness check. A measure that swings wildly across the
 * plausible range is not a finding.
 */
export function sweepParam(
  video: VideoRecord,
  track: readonly TrackPoint[],
  map: MazeMap,
  params: ScoringParams,
  key: keyof ScoringParams,
  values: readonly number[],
): { value: number; summary: TrialSummary }[] {
  return values.map((value) => {
    const trial = { ...params, [key]: value } as ScoringParams;
    return { value, summary: analyze(video, track, map, trial).summary };
  });
}
