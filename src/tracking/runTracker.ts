import { cmToPx } from '../core/geometry';
import type { MazeMap, Point, ScoringParams, TrackPoint } from '../core/types';
import { buildBackground, detectBlob, toGray, type Blob } from './blob';
import { decodeAllFrames, openVideo, sampleBackgroundFrames, toVideoCoords } from './decode';
import { decodeFrameExact, hasWebCodecs } from './webcodecs';
import { resolveNose, resolveOcclusions, smoothTrack } from './occlusion';

/**
 * Tracking pipeline, in this order:
 *   1. median background from frames spread across the video
 *   2. largest blob inside the platform, every frame
 *   3. what each disappearance meant (needs looking forwards)
 *   4. smooth, never across a gap
 */

export interface TrackingProgress {
  phase: 'background' | 'detecting' | 'resolving' | 'done';
  fraction: number;
  message: string;
}

export interface TrackingResult {
  track: TrackPoint[];
  /** Frames per second actually sampled. On the frame-exact path this is the video's own. */
  achievedFps: number;
  /** Which decode path ran. */
  path: 'frame-exact' | 'playback';
  notes: string[];
}

export interface TrackingOptions {
  /** Pixel difference from background that counts as animal. */
  threshold: number;
  /** Smallest blob accepted, as a fraction of platform area. Rejects noise. */
  minAreaFraction: number;
  /** Above 1 trades sampling density for speed. */
  playbackRate: number;
}

export const DEFAULT_TRACKING: TrackingOptions = {
  threshold: 28,
  minAreaFraction: 0.0006,
  playbackRate: 1,
};

/**
 * Detections → track (tracked / in-hole / lost). Shared by the browser and
 * the sample-clip scorer. Never invents a coordinate.
 */
export function detectionsToTrack(
  detections: readonly (Blob | null)[],
  times: readonly number[],
  map: MazeMap,
  params: ScoringParams,
  minArea: number,
  toVideoPoint: (p: Point) => Point = (p) => p,
): TrackPoint[] {
  const states = resolveOcclusions(detections, map, {
    holeProximityPx: cmToPx(map, params.reachedTargetRadiusCm),
    confirmFrames: params.escapeConfirmFrames,
  });

  let previousCentroid: Point | null = null;
  const track: TrackPoint[] = detections.map((blob, i) => {
    const state = states[i] ?? 'lost';
    const t = times[i] ?? 0;

    if (!blob || state !== 'tracked') {
      previousCentroid = null;
      return {
        frame: i,
        t,
        state,
        body: null,
        nose: null,
        confidence: 0,
        provenance: 'auto' as const,
      };
    }

    const nose = resolveNose(blob, previousCentroid);
    previousCentroid = blob.centroid;
    const areaRatio = blob.area / (minArea * 6);
    const confidence = Math.max(0.1, Math.min(1, areaRatio > 1 ? 1 / areaRatio : areaRatio));

    return {
      frame: i,
      t,
      state,
      body: toVideoPoint(blob.centroid),
      nose: nose ? toVideoPoint(nose) : null,
      confidence,
      provenance: 'auto' as const,
    };
  });

  return smoothTrack(track, params.smoothingWindowFrames);
}

export async function trackVideo(
  file: File,
  map: MazeMap,
  params: ScoringParams,
  options: TrackingOptions,
  onProgress: (p: TrackingProgress) => void,
  shouldStop?: () => boolean,
): Promise<TrackingResult> {
  const video = await openVideo(file);
  const notes: string[] = [];

  try {
    // Map is in original video pixels; processing is at a smaller size.
    const scale = video.width / (video.el.videoWidth || video.width);
    const centerP = { x: map.platformCenter.x * scale, y: map.platformCenter.y * scale };
    const radiusP = map.platformRadiusPx * scale;

    // Only search inside the platform (hands, escape box, doors stay out).
    const mask = (x: number, y: number) =>
      (x - centerP.x) ** 2 + (y - centerP.y) ** 2 <= radiusP * radiusP;

    onProgress({ phase: 'background', fraction: 0, message: 'Building a picture of the empty arena' });

    const samples = await sampleBackgroundFrames(video, 25, (done, total) =>
      onProgress({
        phase: 'background',
        fraction: done / total,
        message: `Sampling the arena, frame ${done} of ${total}`,
      }),
    );
    const background = buildBackground(samples);
    // Drop the sample frames; we only needed the median.
    samples.length = 0;
    notes.push(
      `Background built from the per-pixel median of ${samples.length} frames spread across the recording. Median rather than mean, so the animal does not smear into it.`,
    );

    const minArea = Math.max(6, Math.round(Math.PI * radiusP * radiusP * options.minAreaFraction));

    const detections: (Blob | null)[] = [];
    const times: number[] = [];

    onProgress({ phase: 'detecting', fraction: 0, message: 'Finding the animal' });

    // WebCodecs (every frame) first; playback sampling if that fails.
    const canFrameExact = hasWebCodecs() && /\.(mp4|m4v|mov)$/i.test(file.name);

    let sampled = 0;
    let achievedFps = 0;
    let path: TrackingResult['path'] = 'playback';

    if (canFrameExact) {
      // VideoFrame must be drawn and released in the same tick.
      const work = document.createElement('canvas');
      work.width = video.width;
      work.height = video.height;
      const wctx = work.getContext('2d', { willReadFrequently: true });
      if (!wctx) throw new Error('Could not get a 2D canvas context.');

      try {
        const result = await decodeFrameExact(
          file,
          ({ timeS, frame }) => {
            wctx.drawImage(frame, 0, 0, video.width, video.height);
            const rgba = wctx.getImageData(0, 0, video.width, video.height).data;
            const gray = toGray(rgba, video.width, video.height);
            detections.push(detectBlob(gray, background, options.threshold, minArea, mask));
            times.push(timeS);
          },
          {
            shouldStop,
            onProgress: (fraction, n) =>
              onProgress({
                phase: 'detecting',
                fraction,
                message: `Finding the animal, frame ${n}`,
              }),
          },
        );
        sampled = result.decoded;
        achievedFps = result.fps;
        path = 'frame-exact';
      } catch (e) {
        // Codec or container WebCodecs cannot handle. Playback is better than nothing.
        notes.push(
          `Frame-exact decoding was not possible for this file (${
            e instanceof Error ? e.message : 'unknown reason'
          }). Fell back to playback sampling.`,
        );
        detections.length = 0;
        times.length = 0;
      }
    }

    if (path === 'playback') {
      const result = await decodeAllFrames(
        video,
        ({ mediaTime, frame }) => {
          detections.push(detectBlob(frame, background, options.threshold, minArea, mask));
          times.push(mediaTime);
        },
        {
          playbackRate: options.playbackRate,
          shouldStop,
          onProgress: (fraction, n) =>
            onProgress({
              phase: 'detecting',
              fraction,
              message: `Finding the animal, ${n} frames processed`,
            }),
        },
      );
      sampled = result.sampled;
      achievedFps = result.achievedFps;
    }

    if (sampled === 0) throw new Error('No frames were decoded from this video.');

    onProgress({ phase: 'resolving', fraction: 0, message: 'Working out what each disappearance means' });

    const mapP: MazeMap = {
      ...map,
      platformCenter: centerP,
      platformRadiusPx: radiusP,
      holes: map.holes.map((h) => ({ ...h, center: { x: h.center.x * scale, y: h.center.y * scale } })),
    };

    const scaleBack = (p: { x: number; y: number }) =>
      toVideoCoords(p, video.width, video.el.videoWidth || video.width);

    const smoothed = detectionsToTrack(detections, times, mapP, params, minArea, scaleBack);

    const inHole = smoothed.filter(
      (p) => p.state === 'in-target-hole' || p.state === 'in-other-hole',
    ).length;
    const lost = smoothed.filter((p) => p.state === 'lost').length;

    notes.push(
      path === 'frame-exact'
        ? `Every frame in the file was decoded: ${sampled} frames at ${achievedFps.toFixed(1)} fps. Nothing was skipped, and each position carries the container's own timestamp.`
        : `${sampled} frames sampled at ${achievedFps.toFixed(1)} fps by playback${
            options.playbackRate > 1 ? ` at ${options.playbackRate}x` : ''
          }. Frames can be missed on this path if processing falls behind, so this rate may be below the video's own. Timestamps come from the decoder and remain correct.`,
    );
    notes.push(
      inHole > 0
        ? `${inHole} frames were resolved as the animal being inside a hole rather than as a tracking failure.`
        : 'No hole entries were resolved. If the animal escaped, the escape confirmation threshold may be too high.',
    );
    notes.push(
      lost > 0
        ? `${lost} frames have no known position and no evidence of a hole entry. Nothing is drawn across them and no position is invented for them.`
        : 'The animal was localised in every sampled frame.',
    );

    onProgress({ phase: 'done', fraction: 1, message: 'Done' });
    return { track: smoothed, achievedFps, path, notes };
  } finally {
    // Always drop the object URL, even if decoding threw.
    video.close();
  }
}
