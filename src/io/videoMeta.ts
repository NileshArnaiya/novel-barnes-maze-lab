import type { VideoRecord } from '../core/types';

/**
 * Read what a video file can tell us without decoding it.
 *
 * Dimensions and duration come from the `<video>` element's metadata, which is
 * available as soon as the header is parsed. Frame rate does not: the HTML
 * video API does not expose it, and there is no way to read it from a container
 * without a demuxer.
 *
 * So we ask the user. A guessed frame rate is worse than an asked-for one,
 * because every latency, speed and path length in the file scales linearly with
 * it. Getting it silently wrong would make every number wrong by a constant
 * factor, which is the kind of error that survives review.
 */
export function readVideoMetadata(
  file: File,
): Promise<{ width: number; height: number; durationS: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    el.preload = 'metadata';

    const done = (value: { width: number; height: number; durationS: number } | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    el.onloadedmetadata = () =>
      done({
        width: el.videoWidth,
        height: el.videoHeight,
        durationS: Number.isFinite(el.duration) ? el.duration : 0,
      });

    // A codec the browser cannot decode fails here. Common with some AVI files.
    el.onerror = () => done(null);

    el.src = url;
  });
}

/**
 * Read the true frame rate from the MP4 container.
 *
 * The HTML video API does not expose frame rate at all, so the tool used to ask
 * for it and default to 30. That default was wrong for half the sample data:
 * test51 is 15.005 fps and test53 is 29.934. Every latency, speed and path
 * measure scales linearly with the assumed rate, so a 15 fps clip read as 30
 * reports every event at half its true time and every speed at double. The
 * numbers stay perfectly plausible while being wrong by a factor of two, which
 * is the worst kind of error this tool can make.
 *
 * The demuxer knows: total samples divided by duration. We parse only the file
 * header, which is a few hundred kilobytes at most, so this is fast enough to
 * run on load.
 *
 * Returns null when the container cannot be read, and the caller falls back to
 * asking the user rather than guessing.
 */
export async function readContainerFps(file: File): Promise<number | null> {
  if (!/\.(mp4|m4v|mov)$/i.test(file.name)) return null;

  try {
    const MP4Box = (await import('mp4box')).default;
    const mp4 = MP4Box.createFile();

    return await new Promise<number | null>((resolve) => {
      // Give up rather than hang if the container is unusual.
      const timer = setTimeout(() => resolve(null), 4000);

      mp4.onError = () => {
        clearTimeout(timer);
        resolve(null);
      };
      mp4.onReady = (info) => {
        clearTimeout(timer);
        const track = info.videoTracks[0];
        const durationS = info.duration / info.timescale;
        resolve(track && durationS > 0 ? track.nb_samples / durationS : null);
      };

      void (async () => {
        // The moov atom is normally near the start; 4 MB is generous. If it is
        // at the end of the file, onReady never fires and the timeout answers.
        const head = (await file.slice(0, 4 * 1024 * 1024).arrayBuffer()) as Parameters<
          typeof mp4.appendBuffer
        >[0];
        head.fileStart = 0;
        mp4.appendBuffer(head);
        mp4.flush();
      })();
    });
  } catch {
    return null;
  }
}

/**
 * Is this an HDF5 file?
 *
 * SLEAP `.slp` and DeepLabCut `.h5` are both HDF5 containers, which start with
 * a fixed 8-byte signature. Detecting it lets us tell the user precisely what
 * to do instead of silently refusing the file, which is what the tool did
 * before and which gave them nothing to act on.
 */
export async function isHdf5(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const sig = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((b, i) => head[i] === b);
}

/** A video with no tracking yet. Enters the workflow at step 2. */
export function videoRecordFromFile(
  file: File,
  meta: { width: number; height: number; durationS: number },
  fps: number,
  animalId: string,
  day: number | null,
): VideoRecord {
  return {
    id: `${file.name}-${Date.now()}`,
    fileName: file.name,
    durationS: meta.durationS,
    fps,
    width: meta.width || 900,
    height: meta.height || 900,
    animalId,
    cohort: 'imported',
    day,
    trialType: 'acquisition',
    map: null,
    track: null,
    events: null,
    summary: null,
    step: 2,
    strategyOverride: null,
    qcFlag: 'Not tracked yet. Define the maze, then run tracking.',
  };
}
