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
 * Score one trial: events + summary from a track, map, and parameters.
 * Pure, so a slider drag or a parameter sweep just calls it again.
 */
export function analyze(
  video: VideoRecord,
  track: readonly TrackPoint[],
  map: MazeMap,
  params: ScoringParams,
): { events: MazeEvent[]; summary: TrialSummary } {
  const events = detectAllEvents(track, map, params, video.trialType);
  const auto = classifyStrategy(track, events, map);

  // Override keeps the automatic reasons underneath. Confirming the same label
  // still counts as human — otherwise the dropdown looks like it did nothing.
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

/** Re-score the same trial at several values of one parameter. */
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
