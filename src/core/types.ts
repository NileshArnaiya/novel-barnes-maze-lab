/**
 * Domain types for Barnes maze scoring.
 *
 * Design rule that drives this whole file: the tool must never turn "I don't
 * know where the animal is" into a plausible-looking coordinate. Uncertainty is
 * represented explicitly in the type system so it cannot be silently dropped.
 */

/** A point in image space. Pixels, origin top-left, y increases downward. */
export interface Point {
  x: number;
  y: number;
}

/** Where a value came from. Shown in the UI and written into every export. */
export type Provenance = 'auto' | 'human';

/**
 * What the tracker believes is happening in a single frame.
 *
 * The distinction between `in-target-hole` / `in-other-hole` and `lost` is the
 * single most important piece of domain logic in the tool. All three look the
 * same to a blob detector (the animal is not visible) but they mean opposite
 * things: two are successful observations of a behaviour, one is a failure of
 * measurement. Conflating them produces a confident, wrong escape latency.
 */
export type TrackState =
  | 'tracked' // animal found; `body` is valid
  | 'in-target-hole' // disappeared at the escape hole; this is the escape
  | 'in-other-hole' // disappeared at a non-target hole
  | 'lost'; // disappeared with no explanation; `body` is null

/** One frame of tracking. */
export interface TrackPoint {
  /** Zero-based frame index within the trial. */
  frame: number;
  /** Seconds from the start of the trial. */
  t: number;
  state: TrackState;
  /** Body centroid in pixels. Null unless `state === 'tracked'`. */
  body: Point | null;
  /** Estimated nose position. Null when orientation is not resolvable. */
  nose: Point | null;
  /** 0..1. Low values are surfaced to the user, never quietly smoothed away. */
  confidence: number;
  provenance: Provenance;
}

/** One hole in the platform. */
export interface Hole {
  id: string;
  center: Point;
  /**
   * Position around the ring, 0..n-1, ordered counter-clockwise from the
   * hole nearest the top of the image. Serial-search detection depends on
   * this ordering, so it must be stable across videos in a cohort.
   */
  index: number;
  isTarget: boolean;
}

/**
 * The geometry of the maze in one video.
 *
 * Defined once per cohort and registered onto the remaining videos, which is
 * what turns ~1200 clicks into ~20.
 */
export interface MazeMap {
  platformCenter: Point;
  platformRadiusPx: number;
  /** Real-world platform diameter. Without this, path length is unpublishable. */
  platformDiameterCm: number;
  holes: Hole[];
  /**
   * How the map was produced. `registered` means it was aligned from another
   * video and should be shown to the user with its alignment score.
   */
  origin: 'auto-detected' | 'manual' | 'registered';
  /** 0..1 quality of fit when `origin === 'registered'`. */
  registrationScore?: number;
  /**
   * Whether a person has actually chosen the escape hole.
   *
   * A ring is always built with hole 0 flagged as the target, because the type
   * requires one. That default is arbitrary, and latency, errors, quadrant time
   * and strategy are all measured relative to it. Without this flag there is no
   * way to tell a real choice from the placeholder, and the tool would report a
   * confident set of numbers about the wrong hole.
   */
  targetConfirmed?: boolean;
}

/**
 * Barnes maze trials come in two flavours and they are not interchangeable.
 * On a probe trial the escape box is removed, so total latency and escape
 * events are undefined. Scoring them with the same code path produces a
 * confidently wrong column, so the trial type is required, not optional.
 */
export type TrialType = 'acquisition' | 'probe';

/** Every threshold the user can see and change. Stamped into every export. */
export interface ScoringParams {
  /**
   * How close the nose must come to a hole centre to count as investigating
   * it. In centimetres so it is comparable across rigs with different camera
   * heights.
   */
  investigationRadiusCm: number;
  /** Minimum continuous dwell inside that radius, in seconds. */
  investigationMinDwellS: number;
  /** Minimum time between two scored visits to the same hole, in seconds. */
  investigationRefractoryS: number;
  /**
   * How many consecutive frames of disappearance near the target are required
   * before we call it an escape rather than a dropout.
   */
  escapeConfirmFrames: number;
  /** Radius within which the animal counts as having reached the target. */
  reachedTargetRadiusCm: number;
  /** Median-filter window applied to the trajectory, in frames. */
  smoothingWindowFrames: number;
  /**
   * Maximum gap the tool is allowed to interpolate across, in frames.
   * Default 0. Interpolation invents data, so it is opt-in and visible.
   */
  maxGapFillFrames: number;
  /** Trial ends at this time if the animal never escapes, in seconds. */
  trialTimeoutS: number;
}

/** A scored behavioural event. */
export interface MazeEvent {
  kind: 'investigation' | 'escape' | 'reached-target';
  holeId: string | null;
  holeIndex: number | null;
  isTargetHole: boolean;
  startFrame: number;
  endFrame: number;
  startT: number;
  endT: number;
  provenance: Provenance;
}

export type StrategyLabel = 'spatial' | 'serial' | 'random' | 'undetermined';

/**
 * A strategy classification carries its own evidence. The user is expected to
 * disagree sometimes, so the reasoning is shown and the label is overridable.
 */
export interface StrategyResult {
  label: StrategyLabel;
  /** 0..1 confidence in the label. */
  confidence: number;
  /** Human-readable reasons, rendered directly in the UI. */
  reasoning: string[];
  features: {
    holesVisitedBeforeTarget: number;
    /** Straight-line distance to target divided by path travelled. 1 = direct. */
    pathDirectness: number;
    /** Longest run of adjacent holes visited in ring order. */
    longestSerialRun: number;
    /** Fraction of trial spent in the quadrant containing the target. */
    targetQuadrantFraction: number;
    /** Fraction of trial spent within one body-length of the platform edge. */
    thigmotaxisFraction: number;
  };
  provenance: Provenance;
}

/** The numbers a scientist puts in a paper. */
export interface TrialSummary {
  videoId: string;
  animalId: string;
  cohort: string;
  day: number | null;
  trialType: TrialType;

  /** Time to first reach the target hole. Null if never reached. */
  primaryLatencyS: number | null;
  /** Time to enter the escape box. Null on probe trials or if never entered. */
  totalLatencyS: number | null;
  /** Non-target holes investigated before the first target visit. */
  primaryErrors: number;
  /** Non-target holes investigated across the whole trial. */
  totalErrors: number;
  /** Total distance travelled, centimetres. */
  pathLengthCm: number;
  /** Mean speed while moving, cm/s. */
  meanSpeedCmS: number;
  /** Seconds spent in the quadrant containing the target hole. */
  targetQuadrantTimeS: number;
  strategy: StrategyResult;

  /** Fraction of frames where the animal's position was actually observed. */
  trackedFraction: number;
  /** Number of frames a human edited. */
  humanEditedFrames: number;
}

/** A single video and everything derived from it. */
export interface VideoRecord {
  id: string;
  fileName: string;
  /** Present only for the shipped example cohort, which has no video file. */
  synthetic?: boolean;
  durationS: number;
  fps: number;
  width: number;
  height: number;

  animalId: string;
  cohort: string;
  day: number | null;
  trialType: TrialType;

  map: MazeMap | null;
  track: TrackPoint[] | null;
  events: MazeEvent[] | null;
  summary: TrialSummary | null;

  /**
   * A strategy label set by a person, which survives rescoring.
   *
   * The override cannot live in `summary`, because `summary` is recomputed from
   * the track and the parameters every time either changes. Anything written
   * there is discarded on the next slider drag. A human decision has to be an
   * input to scoring, not an output of it.
   */
  strategyOverride: StrategyLabel | null;

  /** Which wizard step this video has reached. */
  step: 1 | 2 | 3 | 4 | 5;
  /** Set when the tool wants a human to look at this one. */
  qcFlag: string | null;
}

export interface Project {
  schemaVersion: 1;
  toolVersion: string;
  createdAt: string;
  params: ScoringParams;
  videos: VideoRecord[];
}
