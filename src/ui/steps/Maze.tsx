import { useEffect, useState } from 'react';
import { angleAround, buildHoleRing, distance, registerMap, rotateMap } from '../../core/geometry';
import type { MazeMap, Point, VideoRecord } from '../../core/types';
import { getFile } from '../../state/fileStore';
import { useStore } from '../../state/store';
import { ArenaCanvas } from '../components/ArenaCanvas';
import { useVideoFrameSource } from '../components/VideoFrameSource';

/**
 * Step 2: define the maze, once.
 *
 * Twenty holes across sixty videos is about 1200 clicks done by hand. This
 * screen exists to make that number roughly twenty: place the ring on one
 * video, mark the escape hole, then apply the same geometry to the rest of the
 * cohort. The stated goal is that the second video is faster than the first.
 *
 * The ring is draggable: move it onto the platform, drag the rim to resize,
 * drag a hole to rotate. Everything that affects scoring stays visible and
 * editable in number fields under the canvas, so nothing is drag-only.
 */
function asManual(map: MazeMap): MazeMap {
  return { ...map, origin: 'manual', registrationScore: undefined };
}

export function Maze({ video, onDone }: { video: VideoRecord; onDone?: () => void }) {
  const { project, updateVideo } = useStore();
  const [holeCount, setHoleCount] = useState(20);
  const [diameterCm, setDiameterCm] = useState(video.map?.platformDiameterCm ?? 92);
  const [applied, setApplied] = useState<number | null>(null);
  // Live geometry while a drag is in progress. Scoring waits until the pointer
  // is released, otherwise every pixel of a drag would rescore the trial.
  const [draftMap, setDraftMap] = useState<MazeMap | null>(null);

  useEffect(() => {
    setDraftMap(null);
  }, [video.id]);

  // Show the footage here, not only in review. This is the first screen after
  // loading, so it is where a user checks that the right file arrived and that
  // the ring they are placing actually lines up with the holes in their maze.
  const { videoEl, seekTick } = useVideoFrameSource(getFile(video.id), 1);

  const map = video.map;
  const live = draftMap ?? map;

  /**
   * Build a default ring when there is no video frame to detect from.
   *
   * Auto-detection needs pixels. Imported pose files have none, so we place a
   * sensible ring from the trajectory's own extent and let the user nudge it.
   * A rough starting point the user adjusts beats an empty canvas.
   */
  const placeDefault = () => {
    const pts = (video.track ?? []).filter((p) => p.body).map((p) => p.body!);
    const cx = pts.length ? pts.reduce((s, p) => s + p.x, 0) / pts.length : video.width / 2;
    const cy = pts.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : video.height / 2;
    const center = { x: cx, y: cy };
    const radius = pts.length
      ? Math.max(...pts.map((p) => distance(center, p))) * 1.15
      : Math.min(video.width, video.height) * 0.42;

    setDraftMap(null);
    updateVideo(video.id, {
      map: {
        platformCenter: center,
        platformRadiusPx: radius,
        platformDiameterCm: diameterCm,
        holes: buildHoleRing(center, radius * 0.87, holeCount, Math.PI / 2, 0),
        origin: 'manual',
      },
      step: 2,
    });
  };

  const commitMap = (next: MazeMap) => {
    setDraftMap(null);
    updateVideo(video.id, { map: asManual(next), step: 2 });
  };

  const placeAt = (center: Point, radiusPx: number, source: MazeMap) => {
    commitMap(asManual(registerMap(source, center, radiusPx)));
  };

  /** Mark the hole nearest the click as the escape hole. */
  const pickTarget = (x: number, y: number) => {
    const source = live;
    if (!source) return;
    let bestId = source.holes[0]?.id;
    let bestD = Infinity;
    for (const h of source.holes) {
      const d = distance(h.center, { x, y });
      if (d < bestD) {
        bestD = d;
        bestId = h.id;
      }
    }
    setDraftMap(null);
    updateVideo(video.id, {
      map: {
        ...source,
        targetConfirmed: true,
        holes: source.holes.map((h) => ({ ...h, isTarget: h.id === bestId })),
      },
    });
  };

  /** Copy this geometry onto every other trial in the cohort. */
  const applyToCohort = () => {
    if (!map) return;
    let n = 0;
    for (const other of project.videos) {
      if (other.id === video.id) continue;
      updateVideo(other.id, {
        map: registerMap(map, map.platformCenter, map.platformRadiusPx),
        step: Math.max(other.step, 2) as VideoRecord['step'],
      });
      n++;
    }
    setApplied(n);
  };

  return (
    <div>
      <h2>Define the maze</h2>
      <p className="hint" style={{ marginTop: 6, marginBottom: 18 }}>
        Do this once for the cohort. The platform size turns pixels into centimetres, which is
        what makes path length comparable between rigs and publishable. After the ring is
        placed, drag it onto the platform, drag the rim to resize, or drag a hole to rotate
        until the overlay sits on the real holes.
      </p>

      <div className="row" style={{ marginBottom: 16 }}>
        <label htmlFor="holes">Holes</label>
        <input
          id="holes"
          type="number"
          min={4}
          max={40}
          value={holeCount}
          style={{ width: 80 }}
          onChange={(e) => setHoleCount(Number(e.target.value))}
        />
        <label htmlFor="diam">Platform diameter</label>
        <input
          id="diam"
          type="number"
          min={20}
          max={300}
          value={diameterCm}
          style={{ width: 90 }}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDiameterCm(v);
            if (map) updateVideo(video.id, { map: { ...map, platformDiameterCm: v } });
          }}
        />
        <span className="hint">cm</span>
        <button onClick={placeDefault}>{map ? 'Reset ring' : 'Place ring'}</button>
      </div>

      <div className="stage" style={{ maxWidth: 560 }}>
        <ArenaCanvas
          map={live}
          track={video.track}
          width={video.width}
          height={video.height}
          onPick={pickTarget}
          onRingPreview={setDraftMap}
          onRingCommit={commitMap}
          videoEl={videoEl}
          seekTick={seekTick}
        />
      </div>

      {live ? (
        <div className="row" style={{ marginTop: 12 }}>
          <label htmlFor="ring-x">Centre x</label>
          <input
            id="ring-x"
            type="number"
            value={Math.round(live.platformCenter.x)}
            style={{ width: 90 }}
            onChange={(e) => {
              const x = Number(e.target.value);
              if (!map || !Number.isFinite(x)) return;
              placeAt({ x, y: live.platformCenter.y }, live.platformRadiusPx, live);
            }}
          />
          <label htmlFor="ring-y">Centre y</label>
          <input
            id="ring-y"
            type="number"
            value={Math.round(live.platformCenter.y)}
            style={{ width: 90 }}
            onChange={(e) => {
              const y = Number(e.target.value);
              if (!map || !Number.isFinite(y)) return;
              placeAt({ x: live.platformCenter.x, y }, live.platformRadiusPx, live);
            }}
          />
          <label htmlFor="ring-r">Radius</label>
          <input
            id="ring-r"
            type="number"
            min={16}
            value={Math.round(live.platformRadiusPx)}
            style={{ width: 90 }}
            onChange={(e) => {
              const r = Number(e.target.value);
              if (!map || !Number.isFinite(r) || r < 16) return;
              placeAt(live.platformCenter, r, live);
            }}
          />
          <span className="hint">px</span>
          <label htmlFor="ring-rot">Rotation</label>
          <input
            id="ring-rot"
            type="number"
            step={1}
            value={
              live.holes[0]
                ? Math.round((angleAround(live.platformCenter, live.holes[0].center) * 180) / Math.PI)
                : 0
            }
            style={{ width: 80 }}
            onChange={(e) => {
              const deg = Number(e.target.value);
              if (!live.holes[0] || !Number.isFinite(deg)) return;
              const current = Math.round(
                (angleAround(live.platformCenter, live.holes[0].center) * 180) / Math.PI,
              );
              commitMap(asManual(rotateMap(live, ((deg - current) * Math.PI) / 180)));
            }}
          />
          <span className="hint">deg</span>
        </div>
      ) : null}

      {map && !map.targetConfirmed ? (
        <div className="notice" style={{ marginTop: 12 }}>
          Click the escape hole. Until you do, the target is hole 0 by default, and latency,
          errors, quadrant time and search strategy are all measured against the wrong hole.
        </div>
      ) : (
        <p className="hint" style={{ marginTop: 10 }}>
          {map
            ? 'Escape hole marked, drawn filled. Click a different hole to change it. Drag the ring, its rim, or a hole to line it up.'
            : 'Place the ring, then drag it onto the platform.'}
        </p>
      )}

      {map ? (
        <div className="panel" style={{ marginTop: 18 }}>
          <h3>Reuse this across the cohort</h3>
          <p className="hint" style={{ margin: '6px 0 14px' }}>
            The same rig filmed the same way needs the same geometry. Applying it here is what
            stops you placing twenty holes sixty times.
          </p>
          <div className="row">
            <button onClick={applyToCohort}>
              Apply to {Math.max(0, project.videos.length - 1)} other trials
            </button>
            <button className="primary" disabled={!map.targetConfirmed} onClick={() => onDone?.()}>
              {map.targetConfirmed ? 'Maze looks right, continue' : 'Mark the escape hole first'}
            </button>
          </div>
          {applied !== null ? (
            <p className="hint" style={{ marginTop: 10 }}>
              Applied to {applied} trials. Check each one in step 4; a trial whose platform sits
              differently will need its own ring.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
