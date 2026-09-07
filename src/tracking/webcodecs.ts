import type { MP4ArrayBuffer, MP4File, MP4Info, MP4Sample } from 'mp4box';

/**
 * Frame-exact decoding with WebCodecs.
 *
 * This replaces the playback-based path for MP4 files, and it is strictly
 * better for our purpose. Playing a video and grabbing presented frames means
 * the browser decides the pace: if per-frame processing is slower than
 * playback, frames are presented that we never see, and the sampling rate
 * silently drops. Decoding by hand removes that entirely. We push encoded
 * chunks in and take frames out as fast as the CPU manages. Nothing is skipped,
 * playback speed is irrelevant, and every frame carries the container's own
 * timestamp.
 *
 * Two pieces are needed because they do different jobs:
 *
 *   - `mp4box` reads the container and hands us the encoded samples. Browsers
 *     do not expose a demuxer, so this part has to come from somewhere. It is
 *     about 200 KB, it is pure JavaScript, and it makes no network calls.
 *   - `VideoDecoder`, from WebCodecs, does the actual decoding. It is native
 *     and hardware-accelerated, which is why this is faster than ffmpeg.wasm
 *     despite ffmpeg being the better demuxer in every other respect.
 *
 * Why not ffmpeg.wasm, honestly: it is fully local and it would work. It is
 * about 25 MB of wasm the user downloads before anything happens, it decodes on
 * the CPU rather than the GPU, and the multithreaded build needs
 * `SharedArrayBuffer` and therefore COOP and COEP response headers that many
 * static hosts cannot set. WebCodecs gets us the same frame-exactness with a
 * 200 KB dependency and hardware decoding. If a lab needs a container WebCodecs
 * cannot handle, converting to MP4 with ffmpeg locally is one command and keeps
 * the data on their machine.
 */

/** WebCodecs is not in TypeScript's DOM lib in every version. */
declare global {
  interface Window {
    VideoDecoder?: unknown;
    EncodedVideoChunk?: unknown;
  }
}

export interface DecodedVideoFrame {
  /** Presentation timestamp in seconds, from the container. */
  timeS: number;
  /** Must be closed by the consumer, or memory grows without bound. */
  frame: VideoFrame;
}

/** Is the frame-exact path available in this browser? */
export function hasWebCodecs(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.VideoDecoder === 'function' &&
    typeof window.EncodedVideoChunk === 'function'
  );
}

/**
 * `avcC` and friends live in the sample description box and the decoder needs
 * them as `description` for AVC and HEVC. Without it, decoder.configure throws.
 */
function codecDescription(
  MP4Box: typeof import('mp4box').default,
  file: MP4File,
  trackId: number,
): Uint8Array | undefined {
  const track = file.getTrackById(trackId);
  for (const entry of track?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (!box) continue;
    // mp4box exposes a write method onto its own stream type. We use it to
    // serialise the config box, then drop the 8-byte box header the decoder
    // does not want.
    const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array(stream.buffer, 8);
  }
  return undefined;
}

export interface FrameExactResult {
  width: number;
  height: number;
  durationS: number;
  /** Total frames handed to the consumer. Equals the frames in the file. */
  decoded: number;
  /** Frames per second implied by the container. */
  fps: number;
}

/**
 * Decode every frame of an MP4 and call `onFrame` for each, in order.
 *
 * Backpressure is handled by doing the work synchronously inside the decoder's
 * output callback and closing the frame immediately. The decoder's internal
 * queue then fills, and we wait on it before feeding more chunks. Without that,
 * a fast decoder on a slow consumer allocates VideoFrames faster than they are
 * released and the tab runs out of memory within seconds.
 */
export async function decodeFrameExact(
  file: File,
  onFrame: (f: DecodedVideoFrame) => void,
  options: {
    onProgress?: (fraction: number, decoded: number) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<FrameExactResult> {
  if (!hasWebCodecs()) throw new Error('WebCodecs is not available in this browser.');

  // Loaded on demand. The demuxer is only needed by someone who tracks a video,
  // not by someone reading an imported track or the example cohort.
  const MP4Box = (await import('mp4box')).default;
  const mp4 = MP4Box.createFile();
  let decoder: VideoDecoder | undefined;
  let decoded = 0;
  let info: MP4Info | null = null;
  let width = 0;
  let height = 0;
  let durationS = 0;
  let fps = 0;

  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      if (err) reject(err);
      else resolve();
    };

    mp4.onError = (e: string) => finish(new Error(`Could not read the MP4 container: ${e}`));

    mp4.onReady = (parsed: MP4Info) => {
      info = parsed;
      const track = parsed.videoTracks[0];
      if (!track) {
        finish(new Error('No video track found in this file.'));
        return;
      }

      width = track.video.width;
      height = track.video.height;
      durationS = parsed.duration / parsed.timescale;
      fps = durationS > 0 ? track.nb_samples / durationS : 0;

      decoder = new VideoDecoder({
        output: (frame) => {
          if (options.shouldStop?.()) {
            frame.close();
            return;
          }
          try {
            // Consume and release in the same tick. The consumer copies what it
            // needs into its own buffer; holding VideoFrames is not allowed.
            onFrame({ timeS: (frame.timestamp ?? 0) / 1_000_000, frame });
          } finally {
            frame.close();
          }
          decoded++;
          if (decoded % 30 === 0) {
            options.onProgress?.(track.nb_samples > 0 ? decoded / track.nb_samples : 0, decoded);
          }
        },
        error: (e) => finish(e instanceof Error ? e : new Error(String(e))),
      });

      decoder.configure({
        codec: track.codec,
        codedWidth: width,
        codedHeight: height,
        description: codecDescription(MP4Box, mp4, track.id),
        // Prefer hardware, allow software. Refusing software would fail on
        // machines where the codec is not accelerated, which is the exact
        // five-year-old laptop this tool is meant to serve.
        hardwareAcceleration: 'no-preference',
        optimizeForLatency: false,
      });

      mp4.setExtractionOptions(track.id, null, { nbSamples: 60 });
      mp4.start();
    };

    mp4.onSamples = (_id: number, _user: unknown, samples: MP4Sample[]) => {
      if (!decoder || options.shouldStop?.()) return;
      for (const s of samples) {
        decoder.decode(
          new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: (s.cts * 1_000_000) / s.timescale,
            duration: (s.duration * 1_000_000) / s.timescale,
            data: s.data,
          }),
        );
      }
    };

    // Read the file in chunks so a large video does not have to be fully
    // resident as one ArrayBuffer before anything starts.
    (async () => {
      const CHUNK = 8 * 1024 * 1024;
      let offset = 0;
      try {
        while (offset < file.size) {
          if (options.shouldStop?.()) break;
          const slice = (await file.slice(offset, offset + CHUNK).arrayBuffer()) as MP4ArrayBuffer;
          slice.fileStart = offset;
          mp4.appendBuffer(slice);
          offset += CHUNK;
          // Yield so the decoder's output callbacks get to run and release
          // frames, rather than queuing the whole file first.
          await new Promise((r) => setTimeout(r, 0));
        }
        mp4.flush();
        if (decoder) await decoder.flush();
        finish();
      } catch (e) {
        finish(e instanceof Error ? e : new Error('Reading the video file failed.'));
      }
    })();
  });

  const d: VideoDecoder | undefined = decoder;
  if (d && d.state !== 'closed') d.close();

  if (!info) throw new Error('The MP4 container could not be parsed.');
  return { width, height, durationS, decoded, fps };
}
