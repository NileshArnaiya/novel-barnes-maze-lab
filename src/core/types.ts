/**
 * Types for scoring. A missing position stays null — never a made-up coordinate.
 */

/** Pixels, origin top-left, y down. */
export interface Point {
  x: number;
  y: number;
}

/** Who produced the value. Written into the export. */
export type Provenance = 'auto' | 'human';

/**
 * Frame-level state. `in-target-hole` / `in-other-hole` / `lost` all look like
 * "no blob" to the detector. Mixing them up invents a fake escape or a fake path.
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
  /** 0..1. Low values are shown, not smoothed away. */
  confidence: number;
  provenance: Provenance;
}

/** One hole in the platform. */
export interface Hole {
  id: string;
  center: Point;
  /** Ring index, 0..n-1, counter-clockwise. Must stay stable across a cohort. */
  index: number;
  isTarget: boolean;
}

/** Maze geometry for one video. Place once, register onto the rest of the cohort. */
export interface MazeMap {
  platformCenter: Point;
  platformRadiusPx: number;
  /** Real diameter. Path length is in cm, so this has to be set. */
  platformDiameterCm: number;
  holes: Hole[];
  /** `registered` = copied from another video. */
  origin: 'auto-detected' | 'manual' | 'registered';
  /** 0..1 when `origin === 'registered'`. */
  registrationScore?: number;
  /**
   * Someone actually picked the escape hole. Hole 0 is only a placeholder;
   * latency and errors are measured against whatever is marked target.
   */
  targetConfirmed?: boolean;
}

/** Probe trials have no escape box, so total latency / escape stay null. */
export type TrialType = 'acquisition' | 'probe';

/** Every threshold the user can see and change. Stamped into every export. */
export interface ScoringParams {
  /** Nose-to-hole distance that counts as an investigation, in cm. */
  investigationRadiusCm: number;
  /** Minimum continuous dwell inside that radius, in seconds. */
  investigationMinDwellS: number;
  /** Minimum time between two scored visits to the same hole, in seconds. */
  investigationRefractoryS: number;
  /** Frames vanished at the target before we call it an escape, not a dropout. */
  escapeConfirmFrames: number;
  /** Radius within which the animal counts as having reached the target. */
  reachedTargetRadiusCm: number;
  /** Median-filter window applied to the trajectory, in frames. */
  smoothingWindowFrames: number;
  /** Max gap to interpolate, in frames. Default 0: do not invent positions. */
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

/** Strategy label plus the evidence, so it can be overridden with the reasons still visible. */
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
   * Human strategy label. Lives here, not in `summary`, because summary is
   * rebuilt on every slider drag.
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
