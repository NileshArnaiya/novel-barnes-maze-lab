import { useRef, useState } from 'react';
import { assessQuality } from '../../core/quality';
import { resolveOcclusions, smoothTrack } from '../../tracking/occlusion';
import { hasWebCodecs } from '../../tracking/webcodecs';
import {
  DEFAULT_TRACKING,
  trackVideo,
  type TrackingOptions,
  type TrackingProgress,
} from '../../tracking/runTracker';
import type { VideoRecord } from '../../core/types';
import { getFile, rememberFile } from '../../state/fileStore';
import { useStore } from '../../state/store';

/**
 * Step 3: tracking.
 *
 * Two paths into the same downstream logic.
 *
 * For a video, we decode every presented frame, subtract a median background,
 * take the largest connected region inside the platform, and then reason about
 * what each disappearance meant.
 *
 * For an imported SLEAP or DeepLabCut track, the positions already exist and
 * detection is skipped. What is still missing is that same reasoning, because a
 * pose estimator reports "no animal found" and stops there. It has no way to
 * know the animal went down a hole. Running our own pass over its output is
 * what recovers escape events from an imported file.
 */
export function Track({ video, onDone }: { video: VideoRecord; onDone?: () => void }) {
  const { project, updateVideo } = useStore();
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TrackingProgress | null>(null);
  const [opts, setOpts] = useState<TrackingOptions>(DEFAULT_TRACKING);
  const stopRef = useRef(false);
  const reselectRef = useRef<HTMLInputElement>(null);

  const file = getFile(video.id);
  // `video.synthetic` first, and only then the extension. The generated example
  // trials are named example-A.mp4 and so matched the video extension test,
  // which made the tool demand a file that has never existed.
  const isVideo =
    !video.synthetic && /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(video.fileName);
  const hasImportedTrack = video.track !== null && !isVideo;

  /** Decode the video and track the animal. */
  const runVideoTracking = async (f: File) => {
    if (!video.map) return;
    setError(null);
    setNotes([]);
    stopRef.current = false;

    try {
      const result = await trackVideo(
        f,
        video.map,
        project.params,
        opts,
        setProgress,
        () => stopRef.current,
      );

      updateVideo(video.id, { track: result.track, fps: result.achievedFps || video.fps, step: 4 });

      const q = assessQuality(result.track, result.achievedFps || video.fps);
      setNotes([...result.notes, q.flag ?? 'Quality looks acceptable. Check the numbers in step 4.']);
      // Straight to the results. The user pressed a button and waited; landing
      // them on the numbers is the answer to "what happened".
      setTimeout(() => onDone?.(), 600);
    } catch (e) {
      // Decoding failures are common and specific: an unsupported codec, a
      // browser without frame callbacks, a file that stops partway. Say which,
      // rather than showing a generic failure the user cannot act on.
      setError(e instanceof Error ? e.message : 'Tracking failed for an unknown reason.');
    } finally {
      setProgress(null);
    }
  };

  /** Re-run occlusion reasoning over positions that already exist. */
  const runOnImportedTrack = () => {
    if (!video.track || !video.map) return;
    setError(null);

    const asBlobs = video.track.map((p) =>
      p.state !== 'lost' && p.body
        ? { centroid: p.body, area: 1, orientation: 0, extremeA: p.body, extremeB: p.body }
        : null,
    );

    const holeProximityPx =
      (project.params.reachedTargetRadiusCm * video.map.platformRadiusPx * 2) /
      video.map.platformDiameterCm;

    const states = resolveOcclusions(asBlobs, video.map, {
      holeProximityPx,
      confirmFrames: project.params.escapeConfirmFrames,
    });

    // A re-run never overwrites a human correction. Someone spent time on those
    // frames and the tracker has no standing to disagree with them.
    const rebuilt = video.track.map((p, i) =>
      p.provenance === 'human' ? p : { ...p, state: states[i] ?? p.state },
    );

    const smoothed = smoothTrack(rebuilt, project.params.smoothingWindowFrames);
    updateVideo(video.id, { track: smoothed, step: 4 });

    const q = assessQuality(smoothed, video.fps);
    const inHole = smoothed.filter(
      (p) => p.state === 'in-target-hole' || p.state === 'in-other-hole',
    ).length;

    setNotes([
      `${(q.trackedFraction * 100).toFixed(1)}% of frames have a known animal position.`,
      inHole > 0
        ? `${inHole} frames were resolved as the animal being inside a hole rather than as lost tracking.`
        : 'No hole entries were identified. If the animal escaped, check the escape confirmation threshold.',
      q.flag ?? 'Quality looks acceptable. Check the numbers in step 4.',
    ]);
    setTimeout(() => onDone?.(), 600);
  };

  return (
    <div>
      <h2>Track the animal</h2>
      <p className="hint" style={{ marginTop: 6, marginBottom: 18 }}>
        Decoding happens in this tab using the browser's own video pipeline. No frames are
        uploaded, no model is downloaded, and nothing is sent anywhere.
      </p>

      {isVideo ? (
        <div className={hasWebCodecs() ? 'notice info' : 'notice'}>
          {hasWebCodecs()
            ? 'Frame-exact decoding is available in this browser. Every frame in the file will be decoded, decoupled from playback, so none are skipped.'
            : 'This browser has no WebCodecs support, so tracking falls back to sampling frames during playback. Frames can be missed if processing falls behind. Chrome, Edge and Safari 16.4 or newer decode every frame. Importing SLEAP or DeepLabCut tracks works here regardless.'}
        </div>
      ) : null}

      {!video.map ? (
        <div className="notice">
          Define the maze in step 2 first. Hole positions are what make it possible to tell a
          hole entry apart from a tracking failure.
        </div>
      ) : null}

      {isVideo && !file ? (
        <div className="notice">
          The video file is not in memory. Tracks and corrections survive a reload but the
          video itself does not, because storing gigabytes of footage in browser storage would
          be worse than asking for it again. Select {video.fileName} to continue.
          <div style={{ marginTop: 10 }}>
            <button onClick={() => reselectRef.current?.click()}>Choose the video again</button>
            <input
              ref={reselectRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  rememberFile(video.id, f);
                  void runVideoTracking(f);
                }
                e.target.value = '';
              }}
            />
          </div>
        </div>
      ) : null}

      {error ? <div className="notice">{error}</div> : null}

      {isVideo ? (
        <div className="panel">
          <h3>Detection settings</h3>
          <div className="param">
            <div className="head">
              <label htmlFor="thr">Difference threshold</label>
              <span className="val">{opts.threshold}</span>
            </div>
            <input
              id="thr"
              type="range"
              min={5}
              max={80}
              step={1}
              value={opts.threshold}
              onChange={(e) => setOpts({ ...opts, threshold: Number(e.target.value) })}
            />
            <p className="help">
              How far a pixel must differ from the empty arena to count as animal. Too low and
              shadows are tracked; too high and a dark animal on a dark patch disappears.
            </p>
          </div>
          <div className="param">
            <div className="head">
              <label htmlFor="rate">Playback speed</label>
              <span className="val">{opts.playbackRate}x</span>
            </div>
            <input
              id="rate"
              type="range"
              min={1}
              max={4}
              step={0.5}
              value={opts.playbackRate}
              onChange={(e) => setOpts({ ...opts, playbackRate: Number(e.target.value) })}
            />
            <p className="help">
              Only used on the playback fallback path. Frame-exact decoding ignores it, because
              it is not tied to playback at all.
            </p>
          </div>
        </div>
      ) : null}

      {progress ? (
        <div className="panel">
          <h3>{progress.message}</h3>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.fraction * 100)}
            aria-label={progress.message}
            style={{
              height: 8,
              background: 'var(--paper-sunk)',
              borderRadius: 4,
              overflow: 'hidden',
              margin: '12px 0',
            }}
          >
            <div
              style={{
                width: `${Math.round(progress.fraction * 100)}%`,
                height: '100%',
                background: 'var(--clay)',
              }}
            />
          </div>
          <button onClick={() => (stopRef.current = true)}>Stop</button>
        </div>
      ) : (
        <button
          className="primary"
          disabled={!video.map || (isVideo ? !file : !hasImportedTrack)}
          onClick={() => (isVideo && file ? void runVideoTracking(file) : runOnImportedTrack())}
        >
          {isVideo ? 'Track this video' : 'Resolve occlusions and smooth'}
        </button>
      )}

      {notes.length > 0 ? (
        <div className="panel" style={{ marginTop: 18 }}>
          <h3>What happened</h3>
          <ul className="reason" style={{ marginTop: 8 }}>
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
