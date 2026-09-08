import { analyze } from '../core/analyze';
import { buildHoleRing } from '../core/geometry';
import { DEFAULT_PARAMS } from '../core/params';
import { assessQuality } from '../core/quality';
import type { MazeMap, Point, Project, TrackPoint, VideoRecord } from '../core/types';

/**
 * Synthetic example trials (two cohorts × three days). Labelled as generated.
 * Scored with the same code as real data so Export has something to draw.
 */

const FPS = 30;
const W = 900;
const H = 900;

function exampleMap(): MazeMap {
  const center: Point = { x: W / 2, y: H / 2 };
  const platformRadiusPx = 380;
  return {
    platformCenter: center,
    platformRadiusPx,
    platformDiameterCm: 92, // a common Barnes maze platform size
    holes: buildHoleRing(center, 330, 20, Math.PI / 2, 0),
    origin: 'manual',
    targetConfirmed: true,
  };
}

/** Same sequence every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Builder {
  points: TrackPoint[];
  at: Point;
}

function make(start: Point): Builder {
  return { points: [], at: start };
}

function moveTo(b: Builder, to: Point, seconds: number, jitter: number, rand: () => number) {
  const frames = Math.max(1, Math.round(seconds * FPS));
  const from = b.at;
  for (let i = 1; i <= frames; i++) {
    const f = i / frames;
    push(b, {
      x: from.x + (to.x - from.x) * f + (rand() - 0.5) * jitter,
      y: from.y + (to.y - from.y) * f + (rand() - 0.5) * jitter,
    });
  }
  b.at = to;
}

function pause(b: Builder, seconds: number, jitter: number, rand: () => number) {
  const frames = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < frames; i++) {
    push(b, { x: b.at.x + (rand() - 0.5) * jitter, y: b.at.y + (rand() - 0.5) * jitter });
  }
}

function push(b: Builder, p: Point) {
  const frame = b.points.length;
  b.points.push({
    frame,
    t: frame / FPS,
    state: 'tracked',
    body: p,
    nose: p,
    confidence: 0.9,
    provenance: 'auto',
  });
}

/** Out of sight, with a stated reason. */
function vanish(b: Builder, seconds: number, state: TrackPoint['state']) {
  const frames = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < frames; i++) {
    const frame = b.points.length;
    b.points.push({
      frame,
      t: frame / FPS,
      state,
      body: null,
      nose: null,
      confidence: 0,
      provenance: 'auto',
    });
  }
}

/** Near-direct route. */
function spatialTrial(map: MazeMap): TrackPoint[] {
  const rand = rng(11);
  const target = map.holes[0]!;
  const b = make(map.platformCenter);
  pause(b, 1.5, 6, rand);
  moveTo(b, { x: map.platformCenter.x + 60, y: map.platformCenter.y - 90 }, 1.2, 8, rand);
  moveTo(b, map.holes[2]!.center, 1.6, 8, rand);
  pause(b, 0.6, 5, rand);
  moveTo(b, target.center, 1.8, 8, rand);
  pause(b, 1.0, 4, rand);
  vanish(b, 2.0, 'in-target-hole');
  return b.points;
}

/** Walks the ring. */
function serialTrial(map: MazeMap): TrackPoint[] {
  const rand = rng(29);
  const b = make(map.platformCenter);
  pause(b, 1.0, 6, rand);
  moveTo(b, map.holes[8]!.center, 2.5, 10, rand);
  for (let i = 7; i >= 1; i--) {
    pause(b, 0.5, 5, rand);
    moveTo(b, map.holes[i]!.center, 0.9, 8, rand);
  }
  pause(b, 0.5, 5, rand);
  moveTo(b, map.holes[0]!.center, 0.9, 8, rand);
  pause(b, 0.8, 4, rand);
  vanish(b, 2.0, 'in-target-hole');
  return b.points;
}

/** Random search plus a real dropout in the middle of the platform. */
function randomTrialWithDropout(map: MazeMap): TrackPoint[] {
  const rand = rng(47);
  const b = make(map.platformCenter);
  pause(b, 1.2, 6, rand);
  moveTo(b, map.holes[14]!.center, 2.0, 12, rand);
  pause(b, 0.7, 6, rand);
  moveTo(b, map.holes[4]!.center, 2.4, 12, rand);
  pause(b, 0.6, 6, rand);
  moveTo(b, { x: map.platformCenter.x - 150, y: map.platformCenter.y + 40 }, 1.5, 12, rand);

  // Lost, not near a hole → tracking failure, not a hole entry.
  vanish(b, 3.5, 'lost');

  b.at = { x: map.platformCenter.x + 120, y: map.platformCenter.y - 60 };
  moveTo(b, map.holes[11]!.center, 1.8, 12, rand);
  pause(b, 0.6, 6, rand);
  moveTo(b, map.holes[0]!.center, 2.2, 12, rand);
  pause(b, 0.9, 5, rand);
  vanish(b, 2.0, 'in-target-hole');
  return b.points;
}

function makeRecord(
  id: string,
  animalId: string,
  track: TrackPoint[],
  map: MazeMap,
  cohort: string,
  day: number,
): VideoRecord {
  const base: VideoRecord = {
    id,
    fileName: `${id}.mp4`,
    synthetic: true,
    durationS: track.length / FPS,
    fps: FPS,
    width: W,
    height: H,
    animalId,
    cohort,
    day,
    trialType: 'acquisition',
    map,
    track,
    events: null,
    summary: null,
    step: 4,
    strategyOverride: null,
    qcFlag: null,
  };

  const { events, summary } = analyze(base, track, map, DEFAULT_PARAMS);
  const quality = assessQuality(track, FPS);

  return { ...base, events, summary, qcFlag: quality.flag };
}

export function buildExampleProject(): Project {
  const map = exampleMap();
  return {
    schemaVersion: 1,
    toolVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    params: DEFAULT_PARAMS,
    videos: [
      makeRecord('example-A', 'M-014', spatialTrial(map), map, 'control', 1),
      makeRecord('example-B', 'M-021', serialTrial(map), map, 'control', 2),
      makeRecord('example-C', 'M-033', randomTrialWithDropout(map), map, 'control', 3),
      makeRecord('example-D', 'M-101', serialTrial(map), map, 'treated', 1),
      makeRecord('example-E', 'M-102', spatialTrial(map), map, 'treated', 2),
      makeRecord('example-F', 'M-103', spatialTrial(map), map, 'treated', 3),
    ],
  };
}
