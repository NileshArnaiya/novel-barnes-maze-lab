import { analyze } from '../core/analyze';
import { DEFAULT_PARAMS } from '../core/params';
import { assessQuality } from '../core/quality';
import type { MazeMap, Project, VideoRecord } from '../core/types';
import { buildBackground, detectBlob, type Blob as AnimalBlob, type Frame } from './blob';
import { detectMaze } from './mazeDetect';
import { DEFAULT_TRACKING, detectionsToTrack } from './runTracker';

export type FrameAt = (index: number) => Frame;

/**
 * Score greyscale frames with the same detect / resolve / analyze path as the
 * browser. Frames are read on demand so a long clip is not held twice in RAM.
 */
export function scoreFrames(
  frameCount: number,
  frameAt: FrameAt,
  fps: number,
  fileName: string,
  animalId: string,
  options: { platformDiameterCm?: number; holeCount?: number; targetHoleIndex?: number } = {},
): VideoRecord {
  if (frameCount <= 0) throw new Error(`No frames for ${fileName}`);
  const first = frameAt(0);
  const mid = frameAt(Math.floor(frameCount / 2));
  const detected = detectMaze(mid, options.holeCount ?? 20, options.platformDiameterCm ?? 92);
  if (!detected.map) {
    throw new Error(`${fileName}: maze detection failed. ${detected.notes.join(' ')}`);
  }

  let map: MazeMap = {
    ...detected.map,
    targetConfirmed: true,
  };
  const targetIndex = options.targetHoleIndex ?? 0;
  map = {
    ...map,
    holes: map.holes.map((h) => ({ ...h, isTarget: h.index === targetIndex })),
  };

  const sampleIdx: number[] = [];
  const n = Math.min(25, frameCount);
  for (let i = 0; i < n; i++) {
    sampleIdx.push(Math.round((i * (frameCount - 1)) / Math.max(n - 1, 1)));
  }
  const background = buildBackground(sampleIdx.map((i) => frameAt(i)));
  const radius = map.platformRadiusPx;
  const minArea = Math.max(6, Math.round(Math.PI * radius * radius * DEFAULT_TRACKING.minAreaFraction));
  const cx = map.platformCenter.x;
  const cy = map.platformCenter.y;
  const mask = (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;

  const detections: (AnimalBlob | null)[] = [];
  for (let i = 0; i < frameCount; i++) {
    detections.push(detectBlob(frameAt(i), background, DEFAULT_TRACKING.threshold, minArea, mask));
  }
  const times = Array.from({ length: frameCount }, (_, i) => i / fps);
  const track = detectionsToTrack(detections, times, map, DEFAULT_PARAMS, minArea);

  const base: VideoRecord = {
    id: fileName.replace(/\.[^.]+$/, ''),
    fileName,
    durationS: frameCount / fps,
    fps,
    width: first.width,
    height: first.height,
    animalId,
    cohort: 'sample',
    day: null,
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
  const quality = assessQuality(track, fps);
  return { ...base, events, summary, qcFlag: quality.flag };
}

export function projectFromVideos(videos: VideoRecord[]): Project {
  return {
    schemaVersion: 1,
    toolVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    params: DEFAULT_PARAMS,
    videos,
  };
}
