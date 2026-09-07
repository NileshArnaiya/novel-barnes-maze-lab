import type { ScoringParams } from './types';

/**
 * Defaults. Every one of these is a judgement call, not a fact, which is why
 * they are all exposed in the UI. See docs/measures.md for the sources and the
 * disagreements in the literature.
 */
export const DEFAULT_PARAMS: ScoringParams = {
  investigationRadiusCm: 3.0,
  investigationMinDwellS: 0.2,
  investigationRefractoryS: 1.0,
  escapeConfirmFrames: 8,
  reachedTargetRadiusCm: 5.0,
  smoothingWindowFrames: 5,
  maxGapFillFrames: 0,
  trialTimeoutS: 180,
};

/** Metadata for rendering the parameter panel. Keeps UI and domain in sync. */
export interface ParamSpec {
  key: keyof ScoringParams;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Shown under the control. Explains what moving it actually changes. */
  help: string;
}

export const PARAM_SPECS: ParamSpec[] = [
  {
    key: 'investigationRadiusCm',
    label: 'Investigation radius',
    unit: 'cm',
    min: 1,
    max: 8,
    step: 0.5,
    help: 'How close the nose must get to a hole to count as investigating it. Larger values inflate error counts because the body passes near holes it never inspected.',
  },
  {
    key: 'investigationMinDwellS',
    label: 'Minimum dwell',
    unit: 's',
    min: 0,
    max: 2,
    step: 0.05,
    help: 'How long the nose must stay inside that radius. Zero counts every pass-by; large values miss genuine fast pokes.',
  },
  {
    key: 'investigationRefractoryS',
    label: 'Refractory period',
    unit: 's',
    min: 0,
    max: 5,
    step: 0.25,
    help: 'How long before the same hole can be scored again. Stops one long investigation being counted as several.',
  },
  {
    key: 'reachedTargetRadiusCm',
    label: 'Reached-target radius',
    unit: 'cm',
    min: 2,
    max: 12,
    step: 0.5,
    help: 'Distance at which the animal counts as having found the target. This defines primary latency.',
  },
  {
    key: 'escapeConfirmFrames',
    label: 'Escape confirmation',
    unit: 'frames',
    min: 1,
    max: 60,
    step: 1,
    help: 'Frames of disappearance at the target hole required before calling it an escape rather than a tracking dropout.',
  },
  {
    key: 'smoothingWindowFrames',
    label: 'Smoothing window',
    unit: 'frames',
    min: 1,
    max: 31,
    step: 2,
    help: 'Median filter width. Removes jitter. Too large and it eats real fast movements, shortening path length.',
  },
  {
    key: 'maxGapFillFrames',
    label: 'Gap interpolation',
    unit: 'frames',
    min: 0,
    max: 30,
    step: 1,
    help: 'Maximum tracking gap to bridge by interpolation. Default zero: interpolated points are invented data. Anything above zero is marked in the export.',
  },
  {
    key: 'trialTimeoutS',
    label: 'Trial timeout',
    unit: 's',
    min: 30,
    max: 600,
    step: 10,
    help: 'Latency assigned when the animal never escapes. Papers differ on whether to use the timeout or exclude the trial.',
  },
];
