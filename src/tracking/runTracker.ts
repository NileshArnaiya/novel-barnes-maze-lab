import { cmToPx } from '../core/geometry';
import type { MazeMap, ScoringParams, TrackPoint } from '../core/types';
import { buildBackground, detectBlob, toGray, type Blob } from './blob';
import { decodeAllFrames, openVideo, sampleBackgroundFrames, toVideoCoords } from './decode';
import { decodeFrameExact, hasWebCodecs } from './webcodecs';
import { resolveNose, resolveOcclusions, smoothTrack } from './occlusion';

/**
 * The whole tracking pipeline, end to end.
 *
 * Four passes, in this order, and the order matters:
 *
 *   1. sample frames spread across the video and take the per-pixel median,
 *      which gives the empty arena
 *   2. walk every presented frame, subtract the background, take the largest
 *      connected region inside the platform
 *   3. decide what each disappearance means, looking forwards and backwards
 *   4. smooth, without smoothing across anything unobserved
 *
 * Steps 3 and 4 are separate from step 2 on purpose. Whether an absence is a
 * hole entry depends on how long it lasts, which the frame it starts in cannot
 * know. A single forward pass would have to guess and revise, and revisions are
 * exactly where silent errors hide.
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
  /** Which decode path ran. Surfaced in the UI so the user knows what they got. */
  path: 'frame-exact' | 'playback';
  notes: string[];
}

export interface TrackingOptions {
  /**
   * How different from the background a pixel must be to count as animal.
   * Exposed rather than tuned into a constant, because lighting varies between
   * rigs far more than any single default can cover.
   */
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
    // The maze map is in original video coordinates; processing happens at a
    // reduced size. Convert once, here, rather than scattering scale factors
    // through the detection code.
    const scale = video.width / (video.el.videoWidth || video.width);
    const centerP = { x: map.platformCenter.x * scale, y: map.platformCenter.y * scale };
    const radiusP = map.platformRadiusPx * scale;

    /**
     * Only look inside the platform.
     *
     * This single line removes the largest source of false detections: the
     * experimenter's hand at the edge of frame, the escape box, a door opening
     * across the room. Anything outside the platform is not the animal, and
     * saying so up front is cheaper and more reliable than filtering later.
     */
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
    // Release the samples immediately. Twenty-five full frames is several
    // megabytes held for the whole run, and the median is all we needed.
    samples.length = 0;
    notes.push(
      `Background built from the per-pixel median of ${samples.length} frames spread across the recording. Median rather than mean, so the animal does not smear into it.`,
    );

    const minArea = Math.max(6, Math.round(Math.PI * radiusP * radiusP * options.minAreaFraction));

    const detections: (Blob | null)[] = [];
    const times: number[] = [];

    onProgress({ phase: 'detecting', fraction: 0, message: 'Finding the animal' });

    /**
     * Two decode paths, and we always prefer the first.
     *
     * Frame-exact: WebCodecs decodes every frame in the file, decoupled from
     * playback, so nothing is ever skipped no matter how slow our per-frame
     * work is. This is the correct way to do it and it is what runs on Chrome,
     * Edge and Safari 16.4 or newer for MP4.
     *
     * Playback: the fallback. Plays the video and takes the frames the browser
     * presents. Frames can be missed if processing falls behind, which is why
     * it is second choice, and why the result reports which path ran.
     */
    const canFrameExact = hasWebCodecs() && /\.(mp4|m4v|mov)$/i.test(file.name);

    let sampled = 0;
    let achievedFps = 0;
    let path: TrackingResult['path'] = 'playback';

    if (canFrameExact) {
      // The decoder hands back a VideoFrame that must be released in the same
      // tick, so we draw it straight into our processing canvas and read the
      // pixels there rather than holding a reference.
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
        // A codec WebCodecs cannot configure, or a container mp4box cannot
        // parse. Fall back rather than failing: a slightly coarser track is
        // far better than no track, and the user is told which they got.
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

    // Occlusion reasoning runs in processing coordinates, so scale the map.
    const mapP: MazeMap = {
      ...map,
      platformCenter: centerP,
      platformRadiusPx: radiusP,
      holes: map.holes.map((h) => ({ ...h, center: { x: h.center.x * scale, y: h.center.y * scale } })),
    };

    const states = resolveOcclusions(detections, mapP, {
      holeProximityPx: cmToPx(mapP, params.reachedTargetRadiusCm),
      confirmFrames: params.escapeConfirmFrames,
    });

    let previousCentroid: { x: number; y: number } | null = null;
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
          provenance: 'auto',
        };
      }

      const nose = resolveNose(blob, previousCentroid);
      previousCentroid = blob.centroid;

      // Confidence from blob area relative to what we expect. A blob far larger
      // than a mouse is usually a hand or a shadow; one barely above the floor
      // is usually noise. Both are surfaced rather than silently accepted.
      const areaRatio = blob.area / (minArea * 6);
      const confidence = Math.max(0.1, Math.min(1, areaRatio > 1 ? 1 / areaRatio : areaRatio));

      return {
        frame: i,
        t,
        state,
        body: toVideoCoords(blob.centroid, video.width, video.el.videoWidth || video.width),
        nose: nose ? toVideoCoords(nose, video.width, video.el.videoWidth || video.width) : null,
        confidence,
        provenance: 'auto',
      };
    });

    const smoothed = smoothTrack(track, params.smoothingWindowFrames);

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
    // Always release the object URL, even if decoding threw. Leaking these
    // holds the whole video file in memory for the life of the tab.
    video.close();
  }
}
