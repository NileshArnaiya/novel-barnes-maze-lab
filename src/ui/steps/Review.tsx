import { useMemo, useState } from 'react';
import { sweepParam } from '../../core/analyze';
import { assessQuality } from '../../core/quality';
import type { StrategyLabel, TrackPoint, VideoRecord } from '../../core/types';
import { useStore } from '../../state/store';
import { getFile } from '../../state/fileStore';
import { ArenaCanvas } from '../components/ArenaCanvas';
import { useVideoFrameSource } from '../components/VideoFrameSource';
import { FigurePanel } from '../components/FigurePanel';
import { ParamsPanel } from '../components/ParamsPanel';
import { useKeyboardShortcuts } from '../components/Shortcuts';
import { Timeline } from '../components/Timeline';

/**
 * Step 4: review and correct.
 *
 * The other four steps are genuinely linear, so they get one screen each. This
 * one is not. Scoring is a loop: read a number, doubt it, jump to the frame,
 * look, fix or accept, watch the number change. Forcing that loop through a
 * wizard would make the most important part of the job the most awkward, so
 * this step opens into a full workspace instead.
 */

const STRATEGIES: StrategyLabel[] = ['spatial', 'serial', 'random', 'undetermined'];

export function Review({ video }: { video: VideoRecord }) {
  const { project, setParams, setTrack, updateVideo } = useStore();
  const [frame, setFrame] = useState(0);
  const [sweepKey, setSweepKey] = useState<'investigationRadiusCm' | 'investigationMinDwellS'>(
    'investigationRadiusCm',
  );

  // The real footage, parked on whatever frame the playhead is on.
  const { videoEl, seekTick, error: videoError } = useVideoFrameSource(
    getFile(video.id),
    (video.track?.[frame]?.t ?? 0),
  );

  const track = video.track ?? [];
  const events = video.events ?? [];
  const summary = video.summary;
  const map = video.map;

  const quality = useMemo(
    () => (track.length > 0 ? assessQuality(track, video.fps) : null),
    [track, video.fps],
  );

  // The sensitivity sweep. Recomputed only when the inputs change, because it
  // runs the full analysis once per sample point.
  const sweep = useMemo(() => {
    if (!map || track.length === 0) return [];
    const values =
      sweepKey === 'investigationRadiusCm' ? [1, 2, 3, 4, 5, 6, 7] : [0, 0.1, 0.2, 0.4, 0.8, 1.2];
    return sweepParam(video, track, map, project.params, sweepKey, values);
  }, [video, track, map, project.params, sweepKey]);

  /**
   * Frame navigation from the keyboard.
   *
   * This must sit above every early return. React identifies hooks by call
   * order, so a hook after a conditional return is called on some renders and
   * not others, and the component crashes with "rendered fewer hooks than
   * expected" the moment the condition flips. That is exactly what happened
   * when a trial without a map was selected.
   *
   * Stepping frames is the most repeated action in the tool and was mouse-only.
   * G jumps to the next unexplained gap, which is what a reviewer is usually
   * hunting for; without it, finding a two-second dropout in a three-minute
   * trial means dragging the timeline and hoping.
   */
  useKeyboardShortcuts(
    useMemo(() => {
      const go = (f: number) => setFrame(Math.max(0, Math.min(track.length - 1, f)));
      const lose = () => {
        if (track.length === 0) return;
        setTrack(
          video.id,
          track.map((p, i) =>
            i === frame
              ? { ...p, state: 'lost' as const, body: null, nose: null, confidence: 0, provenance: 'human' as const }
              : p,
          ),
        );
      };
      return {
        ArrowLeft: () => go(frame - 1),
        ArrowRight: () => go(frame + 1),
        'Shift+ArrowLeft': () => go(frame - 10),
        'Shift+ArrowRight': () => go(frame + 10),
        Home: () => go(0),
        End: () => go(track.length - 1),
        x: lose,
        X: lose,
        g: () => {
          const next = quality?.gaps.find((gp) => gp.startFrame > frame) ?? quality?.gaps[0];
          if (next) go(next.startFrame);
        },
      };
    }, [frame, track, quality, setTrack, video.id]),
  );

  if (!map) {
    return (
      <div className="panel">
        <h3>The maze is not defined for {video.animalId}</h3>
        <p className="hint" style={{ marginTop: 8 }}>
          Nothing can be scored until the tool knows where the holes are. Go to step 2, place the
          ring on the platform, and click the escape hole.
        </p>
      </div>
    );
  }

  if (!summary || !video.track) {
    return (
      <div className="panel">
        <h3>{video.animalId} has not been tracked yet</h3>
        <p className="hint" style={{ marginTop: 8 }}>
          The maze is defined, so the next thing is to find the animal. Go to step 3 and run
          tracking. On a thirty-second clip this takes a few seconds.
        </p>
      </div>
    );
  }

  /**
   * Sanity check the numbers against what a mouse can physically do.
   *
   * A mean speed of tens of centimetres per second is not a fast mouse, it is
   * a broken calibration or a tracker jumping between the animal and something
   * else. Reporting it without comment would be the tool lying quietly, which
   * is the failure mode the whole design is meant to avoid. Laboratory mice
   * move at roughly 5 to 15 cm/s during exploration, with brief bursts higher.
   */
  const plausibility =
    summary.meanSpeedCmS > 40
      ? `Mean speed of ${summary.meanSpeedCmS.toFixed(0)} cm/s is faster than a mouse runs. Either the platform diameter is wrong, which scales every distance, or the tracker is jumping between the animal and something else. Check the maze in step 2 and the detection threshold in step 3 before using these numbers.`
      : summary.meanSpeedCmS > 0 && summary.meanSpeedCmS < 1.5
        ? `Mean speed of ${summary.meanSpeedCmS.toFixed(1)} cm/s is slower than an exploring mouse. Check that the platform diameter matches your rig.`
        : null;

  // A target hole is required for latency, errors, quadrant time and strategy.
  // Defaulting to hole 0 silently would make every one of those wrong.
  const noTarget = !map.targetConfirmed;

  /**
   * Mark the current frame as a tracking failure.
   *
   * Correction runs in both directions. A user must be able to say "the tracker
   * found something here but it was wrong", not only "it missed the animal".
   * Deleting a bad point is as important as adding a good one, and both are
   * recorded as human decisions.
   */
  const markLost = () => {
    const next: TrackPoint[] = track.map((p, i) =>
      i === frame ? { ...p, state: 'lost', body: null, nose: null, confidence: 0, provenance: 'human' } : p,
    );
    setTrack(video.id, next);
  };

  /** Place the animal at a clicked position on the current frame. */
  const placeAt = (x: number, y: number) => {
    const next: TrackPoint[] = track.map((p, i) =>
      i === frame
        ? { ...p, state: 'tracked', body: { x, y }, nose: p.nose, confidence: 1, provenance: 'human' }
        : p,
    );
    setTrack(video.id, next);
  };

  const jumpTo = (f: number) => setFrame(Math.max(0, Math.min(track.length - 1, f)));

  const current = track[frame];

  const reachedFrame = events.find((e) => e.kind === 'reached-target')?.startFrame ?? null;
  const escapeFrame = events.find((e) => e.kind === 'escape')?.startFrame ?? null;

  return (
    <div>
      {video.synthetic ? (
        <div className="notice info">
          This is generated example data, not a real recording. It exists so the tool has
          something to show before you load your own videos. Everything you see was produced
          by the same scoring code your data will go through.
        </div>
      ) : null}

      {quality?.flag ? <div className="notice">{quality.flag}</div> : null}
      {videoError ? <div className="notice">{videoError}</div> : null}
      {!video.synthetic && /\.(mp4|mov|m4v|webm)$/i.test(video.fileName) && !videoEl && !videoError ? (
        <div className="notice">
          The footage is not loaded, so the path is drawn on a schematic arena. Tracks and
          corrections survived, but the video itself is not kept across a reload. Re-select it in
          step 3 to check the overlay against the real frames.
        </div>
      ) : null}

      {plausibility ? <div className="notice">{plausibility}</div> : null}
      {noTarget ? (
        <div className="notice">
          No escape hole has been marked, so the target is hole 0 by default and every
          target-relative number here is meaningless. Go to step 2 and click the hole the animal
          escapes through.
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 460px', minWidth: 320 }}>
          <div className="stage">
            <ArenaCanvas
              map={map}
              track={track}
              width={video.width}
              height={video.height}
              currentFrame={frame}
              onPick={placeAt}
              videoEl={videoEl}
              seekTick={seekTick}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <Timeline track={track} events={events} currentFrame={frame} onSeek={jumpTo} />
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={() => jumpTo(frame - 1)} aria-label="Previous frame">
              &lsaquo; frame
            </button>
            <button onClick={() => jumpTo(frame + 1)} aria-label="Next frame">
              frame &rsaquo;
            </button>
            <span className="hint" style={{ fontFamily: 'var(--font-mono)' }}>
              {frame} / {track.length - 1} · {(frame / video.fps).toFixed(2)}s ·{' '}
              {current?.state ?? 'unknown'}
              {current?.provenance === 'human' ? ' (edited)' : ''}
            </span>
            <span className="grow" />
            <button onClick={markLost}>Mark as not tracked</button>
          </div>

          <p className="hint" style={{ marginTop: 8 }}>
            Click anywhere on the platform to place the animal on this frame. Corrections are
            drawn in a different colour and are never overwritten by re-running the tracker.
          </p>

          {quality && quality.gaps.length > 0 ? (
            <div className="panel" style={{ marginTop: 16 }}>
              <h3>Gaps in tracking</h3>
              <p className="hint">
                The path is broken at these points because the animal was not visible and there
                was no evidence it had entered a hole. Nothing is drawn across them.
              </p>
              <div className="row">
                {quality.gaps.map((g) => (
                  <button key={g.startFrame} onClick={() => jumpTo(g.startFrame)}>
                    {g.startT.toFixed(1)}s to {g.endT.toFixed(1)}s
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ flex: '1 1 320px', minWidth: 300 }}>
          <div className="panel">
            <h3>Measures</h3>
            <div className="metrics" style={{ marginTop: 12 }}>
              <Metric
                label="Primary latency"
                value={summary.primaryLatencyS}
                unit="s"
                onJump={reachedFrame !== null ? () => jumpTo(reachedFrame) : undefined}
                emptyNote="never reached"
              />
              <Metric
                label="Total latency"
                value={summary.totalLatencyS}
                unit="s"
                onJump={escapeFrame !== null ? () => jumpTo(escapeFrame) : undefined}
                emptyNote={video.trialType === 'probe' ? 'probe trial' : 'never escaped'}
              />
              <Metric label="Primary errors" value={summary.primaryErrors} unit="" integer />
              <Metric label="Total errors" value={summary.totalErrors} unit="" integer />
              <Metric label="Path length" value={summary.pathLengthCm} unit="cm" />
              <Metric label="Mean speed" value={summary.meanSpeedCmS} unit="cm/s" />
              <Metric label="Target quadrant" value={summary.targetQuadrantTimeS} unit="s" />
              <Metric
                label="Frames tracked"
                value={summary.trackedFraction * 100}
                unit="%"
              />
            </div>
          </div>

          <div className="panel">
            <h3>Search strategy</h3>
            <div className="row" style={{ marginTop: 10 }}>
              <select
                value={summary.strategy.label}
                aria-label="Search strategy"
                onChange={(e) =>
                  updateVideo(video.id, { strategyOverride: e.target.value as StrategyLabel })
                }
              >
                {STRATEGIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="hint">
                {summary.strategy.provenance === 'human'
                  ? 'set by you, kept when thresholds change'
                  : `automatic, confidence ${summary.strategy.confidence.toFixed(2)}`}
              </span>
              {video.strategyOverride ? (
                <button onClick={() => updateVideo(video.id, { strategyOverride: null })}>
                  Use the automatic label
                </button>
              ) : null}
            </div>
            <ul className="reason" style={{ marginTop: 12 }}>
              {summary.strategy.reasoning.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>

          <div className="panel">
            <h3>How sensitive is this result?</h3>
            <p className="hint" style={{ marginTop: 4 }}>
              Every threshold is a judgement call. If a number moves a lot across the plausible
              range of one, it is a property of the threshold rather than of the animal.
            </p>
            <div className="row" style={{ margin: '12px 0' }}>
              <select
                value={sweepKey}
                aria-label="Threshold to sweep"
                onChange={(e) => setSweepKey(e.target.value as typeof sweepKey)}
              >
                <option value="investigationRadiusCm">Investigation radius</option>
                <option value="investigationMinDwellS">Minimum dwell</option>
              </select>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>{sweepKey === 'investigationRadiusCm' ? 'radius (cm)' : 'dwell (s)'}</th>
                  <th>primary errors</th>
                  <th>total errors</th>
                  <th>strategy</th>
                </tr>
              </thead>
              <tbody>
                {sweep.map((s) => (
                  <tr key={s.value}>
                    <td className="num">{s.value}</td>
                    <td className="num">{s.summary.primaryErrors}</td>
                    <td className="num">{s.summary.totalErrors}</td>
                    <td>{s.summary.strategy.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <FigurePanel video={video} />

          <div className="panel">
            <ParamsPanel params={project.params} onChange={setParams} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One measure.
 *
 * Null is rendered as a word, never as a zero or a dash. "Never reached" and
 * "0.0 seconds" mean opposite things, and a reader skimming a grid of numbers
 * will not stop to work out which one an empty cell meant.
 */
function Metric({
  label,
  value,
  unit,
  integer,
  onJump,
  emptyNote,
}: {
  label: string;
  value: number | null;
  unit: string;
  integer?: boolean;
  onJump?: () => void;
  emptyNote?: string;
}) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      {value === null ? (
        <div className="value null">{emptyNote ?? 'not available'}</div>
      ) : (
        <div className="value">
          {integer ? value : value.toFixed(1)}
          {unit ? <span style={{ fontSize: 13 }}> {unit}</span> : null}
        </div>
      )}
      {onJump ? (
        <button className="jump" onClick={onJump}>
          go to frame
        </button>
      ) : null}
    </div>
  );
}
