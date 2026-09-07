import { buildHoleRing } from '../src/core/geometry';
import type { MazeMap, TrackPoint, VideoRecord } from '../src/core/types';

/**
 * Synthetic trajectories with answers we can work out on paper.
 *
 * Testing a scoring tool against real video is circular: the tracker produces
 * the trajectory and then we check the measures against the same trajectory, so
 * a systematic tracking error passes silently. Generating trajectories with
 * known ground truth breaks that circle. If a beeline of known length does not
 * come back with that length, the bug is in the measures, not the video.
 *
 * These fixtures are also what the parameter-sensitivity work is validated
 * against, since we know exactly how many holes were genuinely approached.
 */

export const FPS = 30;

/** A 100 cm platform, 20 holes, target at index 0, at a convenient scale. */
export function makeMap(): MazeMap {
  const center = { x: 500, y: 500 };
  const platformRadiusPx = 400; // 400 px = 50 cm, so 8 px per cm
  return {
    platformCenter: center,
    platformRadiusPx,
    platformDiameterCm: 100,
    holes: buildHoleRing(center, 350, 20, 0, 0),
    origin: 'manual',
    targetConfirmed: true,
  };
}

export function makeVideo(overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: 'synthetic-1',
    fileName: 'synthetic.mp4',
    synthetic: true,
    durationS: 60,
    fps: FPS,
    width: 1000,
    height: 1000,
    animalId: 'M001',
    cohort: 'test',
    day: 1,
    trialType: 'acquisition',
    map: null,
    track: null,
    events: null,
    summary: null,
    step: 4,
    strategyOverride: null,
    qcFlag: null,
    ...overrides,
  };
}

/** A tracked point at a given position and frame. */
function pt(frame: number, x: number, y: number): TrackPoint {
  return {
    frame,
    t: frame / FPS,
    state: 'tracked',
    body: { x, y },
    nose: { x, y },
    confidence: 1,
    provenance: 'auto',
  };
}

/**
 * A straight line from A to B over `frames` frames.
 * Path length is exactly the distance from A to B, which is what we assert.
 */
export function straightLine(
  from: { x: number; y: number },
  to: { x: number; y: number },
  frames: number,
  startFrame = 0,
): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let i = 0; i <= frames; i++) {
    const f = i / frames;
    out.push(pt(startFrame + i, from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f));
  }
  return out;
}

/** Hold still at one position for `frames` frames. */
export function dwell(
  at: { x: number; y: number },
  frames: number,
  startFrame: number,
): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let i = 0; i < frames; i++) out.push(pt(startFrame + i, at.x, at.y));
  return out;
}

/** Frames where the animal is not visible. Used to test occlusion handling. */
export function absent(
  frames: number,
  startFrame: number,
  state: TrackPoint['state'] = 'lost',
): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let i = 0; i < frames; i++) {
    out.push({
      frame: startFrame + i,
      t: (startFrame + i) / FPS,
      state,
      body: null,
      nose: null,
      confidence: 0,
      provenance: 'auto',
    });
  }
  return out;
}

/** Renumber frames and timestamps so concatenated segments stay consistent. */
export function concat(...segments: TrackPoint[][]): TrackPoint[] {
  const all = segments.flat();
  return all.map((p, i) => ({ ...p, frame: i, t: i / FPS }));
}
