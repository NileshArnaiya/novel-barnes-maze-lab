import { toGray, type Frame } from './blob';

/**
 * Video decoding, using only what the browser already has.
 *
 * The dependency decision here is the most consequential one in the project, so
 * it is worth stating plainly.
 *
 * Rejected: `ffmpeg.wasm`. It gives frame-exact demuxing, and its multithreaded
 * build requires `SharedArrayBuffer`, which requires `Cross-Origin-Opener-Policy`
 * and `Cross-Origin-Embedder-Policy` response headers. Many static hosts cannot
 * set headers at all, and COEP breaks every cross-origin resource on the page.
 * That is a deployment tarpit in exchange for a precision this assay does not
 * need: hole investigations last hundreds of milliseconds, not single frames.
 *
 * Rejected: any hosted vision API. See the README. Video of animal work sits
 * under an IACUC protocol and at many institutions cannot leave the building.
 *
 * Rejected: a bundled segmentation model via ONNX Runtime Web or TensorFlow.js.
 * Weights are a multi-megabyte download the user did not ask for, the runtime
 * is a black box they cannot audit, and on a five-year-old laptop with no GPU
 * the WASM backend is slower than the classical pipeline it would replace.
 *
 * Chosen: `HTMLVideoElement` plus `requestVideoFrameCallback` plus a 2D canvas.
 * All native, zero bytes added to the bundle, zero network requests, and the
 * decoding is done by the same hardware-accelerated pipeline the browser uses
 * to play the video. The cost is that we get frames as they are presented
 * rather than by index, which is handled honestly below.
 */

/** `requestVideoFrameCallback` is not in TypeScript's DOM lib yet. */
interface VideoFrameMetadata {
  mediaTime: number;
  presentedFrames: number;
}
type RVFC = (
  cb: (now: number, metadata: VideoFrameMetadata) => void,
) => number;

type VideoWithRVFC = HTMLVideoElement & Partial<{
  requestVideoFrameCallback: RVFC;
  cancelVideoFrameCallback: (handle: number) => void;
}>;

export interface OpenVideo {
  el: VideoWithRVFC;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  durationS: number;
  /** Revokes the object URL. Always call this. */
  close: () => void;
}

/**
 * Downscale long edge for processing.
 *
 * Blob detection does not need full resolution: a mouse is tens of pixels
 * across either way, and connected-component labelling is linear in pixel
 * count. Halving the edge quarters the work. Positions are scaled back up to
 * original video coordinates so the maze map and the trajectory stay in one
 * coordinate system.
 */
const PROCESS_LONG_EDGE = 640;

export async function openVideo(file: File): Promise<OpenVideo> {
  const url = URL.createObjectURL(file);
  const el = document.createElement('video') as VideoWithRVFC;
  el.src = url;
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    el.onloadedmetadata = () => resolve();
    el.onerror = () =>
      reject(
        new Error(
          'This browser cannot decode that video. H.264 MP4 works everywhere; some AVI and MKV codecs work nowhere in a browser.',
        ),
      );
  });

  const scale = Math.min(1, PROCESS_LONG_EDGE / Math.max(el.videoWidth, el.videoHeight));
  const width = Math.round(el.videoWidth * scale);
  const height = Math.round(el.videoHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  // `willReadFrequently` matters here: without it Chrome keeps the canvas on
  // the GPU and every getImageData is a stall. With it we get a CPU-backed
  // canvas, which is what a read-every-frame workload wants.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get a 2D canvas context.');

  return {
    el,
    canvas,
    ctx,
    width,
    height,
    durationS: Number.isFinite(el.duration) ? el.duration : 0,
    close: () => {
      el.pause();
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
    },
  };
}

/** Grab the currently displayed frame as luminance. */
function grab(v: OpenVideo): Frame {
  v.ctx.drawImage(v.el, 0, 0, v.width, v.height);
  const rgba = v.ctx.getImageData(0, 0, v.width, v.height).data;
  return toGray(rgba, v.width, v.height);
}

/** Seek to a timestamp and wait for the frame to actually be ready. */
function seekTo(v: OpenVideo, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      v.el.removeEventListener('seeked', onSeeked);
      resolve();
    };
    v.el.addEventListener('seeked', onSeeked);
    // A seek past the end never fires `seeked` in some browsers, so clamp.
    v.el.currentTime = Math.min(Math.max(0, t), Math.max(0, v.durationS - 0.05));
    setTimeout(() => {
      v.el.removeEventListener('seeked', onSeeked);
      reject(new Error('Timed out seeking in the video.'));
    }, 8000);
  });
}

/**
 * Sample frames spread across the whole video, for the background model.
 *
 * Spread across the whole video rather than taken from the start, because the
 * animal must be in a different place in most of them for the per-pixel median
 * to converge on the empty arena. Sampling the first ten seconds of a trial
 * where the mouse sits under the start cylinder would bake the mouse into the
 * background and then fail to detect it for the rest of the trial.
 *
 * Seeking is used here rather than playback: we want specific spread-out
 * timestamps, there are only a couple of dozen of them, and the cost is a
 * second or two once per video.
 */
export async function sampleBackgroundFrames(
  v: OpenVideo,
  count = 25,
  onProgress?: (done: number, total: number) => void,
): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (let i = 0; i < count; i++) {
    // Avoid the very start and very end, which are often the experimenter's
    // hand placing or removing the animal.
    const t = v.durationS * (0.05 + (0.9 * i) / Math.max(1, count - 1));
    await seekTo(v, t);
    frames.push(grab(v));
    onProgress?.(i + 1, count);
  }
  return frames;
}

export interface DecodedFrame {
  /** Real presentation time from the decoder, not an assumption. */
  mediaTime: number;
  frame: Frame;
}

/**
 * Walk every presented frame of the video.
 *
 * Playback plus `requestVideoFrameCallback` rather than seek-per-frame. A
 * three-minute trial at 30 fps is 5400 frames, and seeking to each one takes
 * tens of milliseconds, which is several minutes of waiting. Playback decodes
 * at native speed or faster and hands us each frame as it is presented.
 *
 * The honest part: if our per-frame work is slower than playback, the browser
 * presents frames we never see, and we get a gap. We do not pretend otherwise.
 * Every callback carries `mediaTime` from the decoder, so each sample is
 * timestamped with when it actually happened rather than with an assumed frame
 * index. The caller is told the achieved sampling rate, and downstream code
 * treats unsampled stretches as unsampled rather than inventing positions in
 * them.
 *
 * `playbackRate` above 1 trades sampling density for speed. At 2x on a 30 fps
 * video we see roughly every other frame, which is still far finer than the
 * dwell thresholds that define an investigation.
 */
export async function decodeAllFrames(
  v: OpenVideo,
  onFrame: (f: DecodedFrame) => void,
  options: {
    playbackRate?: number;
    onProgress?: (fraction: number, sampled: number) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<{ sampled: number; achievedFps: number }> {
  const { playbackRate = 1, onProgress, shouldStop } = options;

  if (typeof v.el.requestVideoFrameCallback !== 'function') {
    throw new Error(
      'This browser does not support frame-accurate video callbacks. Chrome, Edge and Safari 15.4 or newer do; Firefox does not yet.',
    );
  }

  await seekTo(v, 0);
  v.el.playbackRate = playbackRate;

  let sampled = 0;
  let lastMediaTime = 0;

  await new Promise<void>((resolve, reject) => {
    const step = (_now: number, meta: VideoFrameMetadata) => {
      if (shouldStop?.()) {
        v.el.pause();
        resolve();
        return;
      }

      try {
        onFrame({ mediaTime: meta.mediaTime, frame: grab(v) });
      } catch (e) {
        v.el.pause();
        reject(e instanceof Error ? e : new Error('Frame processing failed.'));
        return;
      }

      sampled++;
      lastMediaTime = meta.mediaTime;
      if (sampled % 15 === 0 && v.durationS > 0) {
        onProgress?.(meta.mediaTime / v.durationS, sampled);
      }

      v.el.requestVideoFrameCallback!(step);
    };

    v.el.onended = () => resolve();
    v.el.onerror = () => reject(new Error('The video stopped decoding partway through.'));

    v.el.requestVideoFrameCallback!(step);
    void v.el.play().catch((e) => reject(e instanceof Error ? e : new Error('Playback blocked.')));
  });

  v.el.pause();

  return {
    sampled,
    achievedFps: lastMediaTime > 0 ? sampled / lastMediaTime : 0,
  };
}

/** Scale a processing-resolution point back to original video coordinates. */
export function toVideoCoords(
  p: { x: number; y: number },
  processWidth: number,
  videoWidth: number,
): { x: number; y: number } {
  const k = videoWidth / processWidth;
  return { x: p.x * k, y: p.y * k };
}
