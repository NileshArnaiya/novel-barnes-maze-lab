import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { angleAround, distance, registerMap, rotateMap } from '../../core/geometry';
import type { Hole, MazeMap, Point, TrackPoint } from '../../core/types';

/**
 * The arena view.
 *
 * This is the verification surface for the whole tool. A user does not check a
 * latency by reading an array of coordinates, they check it by looking at the
 * path and seeing whether it goes where they remember the animal going. So the
 * rendering rules are chosen for honesty rather than for looking finished:
 *
 *   - a stretch where the animal was not seen is a break in the line, never a
 *     smooth join. The lie a joined line tells is the exact failure mode this
 *     tool is built to avoid.
 *   - frames a human corrected are drawn differently from frames the tracker
 *     produced, so a reviewer can see how much of the trace is machine output.
 *   - the target hole is the only filled shape on the platform.
 */

interface Props {
  map: MazeMap | null;
  track: readonly TrackPoint[] | null;
  width: number;
  height: number;
  /** Frame index of the playhead; drawn as a marker. */
  currentFrame?: number;
  /** Called with maze coordinates when the user clicks, for hole selection. */
  onPick?: (x: number, y: number) => void;
  /**
   * Live ring placement while a drag is in progress. Passing null clears a
   * preview that was cancelled. Review does not set this, so a click there
   * still only places the animal.
   */
  onRingPreview?: (map: MazeMap | null) => void;
  /** Commit a finished move, resize, or rotate. */
  onRingCommit?: (map: MazeMap) => void;
  /**
   * The real footage, parked on the current frame. Drawn underneath everything
   * else so the user can check the overlay against what actually happened
   * rather than taking the tool's word for it.
   */
  videoEl?: HTMLVideoElement | null;
  /**
   * Changes when the video element finishes seeking. Only used as a redraw
   * trigger: without it the canvas paints the previous frame, because seeking
   * completes after the render that requested it.
   */
  seekTick?: number;
}

type RingHit = 'rim' | 'hole' | 'inside' | 'none';
type DragState = {
  mode: 'move' | 'resize' | 'rotate';
  snapshot: MazeMap;
  start: Point;
  moved: boolean;
  last: MazeMap;
  grabOffset: Point;
  startAngle: number;
  startDist: number;
  hole?: Hole;
};

function mazePoint(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * width,
    y: ((clientY - rect.top) / rect.height) * height,
  };
}

function displayScale(canvas: HTMLCanvasElement, width: number): number {
  const w = canvas.getBoundingClientRect().width;
  return w > 0 ? width / w : 1;
}

function resizeHandles(map: MazeMap): Point[] {
  const { x, y } = map.platformCenter;
  const r = map.platformRadiusPx;
  return [
    { x: x + r, y },
    { x, y: y - r },
    { x: x - r, y },
    { x, y: y + r },
  ];
}

function hitRing(map: MazeMap, p: Point, slop: number): { kind: RingHit; hole?: Hole } {
  let nearestHole: Hole | undefined;
  let nearestHoleD = Infinity;
  for (const hole of map.holes) {
    const d = distance(hole.center, p);
    if (d < nearestHoleD) {
      nearestHoleD = d;
      nearestHole = hole;
    }
  }
  const nearHole = nearestHole !== undefined && nearestHoleD <= slop;

  let nearestHandleD = Infinity;
  for (const handle of resizeHandles(map)) {
    nearestHandleD = Math.min(nearestHandleD, distance(handle, p));
  }
  const dCenter = distance(map.platformCenter, p);
  const nearRim = Math.abs(dCenter - map.platformRadiusPx) <= slop || nearestHandleD <= slop;

  // A hole near the rim still belongs to the hole: click marks it, drag
  // rotates. Grab the handle between holes to resize.
  if (nearHole) return { kind: 'hole', hole: nearestHole };
  if (nearRim) return { kind: 'rim' };
  if (dCenter < map.platformRadiusPx) return { kind: 'inside' };
  return { kind: 'none' };
}

function asManual(map: MazeMap): MazeMap {
  return { ...map, origin: 'manual', registrationScore: undefined };
}

function cursorFor(hit: RingHit): string {
  if (hit === 'rim') return 'nwse-resize';
  if (hit === 'inside') return 'grab';
  if (hit === 'hole') return 'pointer';
  return 'default';
}

export function ArenaCanvas({
  map,
  track,
  width,
  height,
  currentFrame,
  onPick,
  onRingPreview,
  onRingCommit,
  videoEl,
  seekTick,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [cursor, setCursor] = useState('default');
  const editRing = Boolean(onRingPreview && onRingCommit);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (videoEl && videoEl.readyState >= 2) {
      // The real frame. Everything else is drawn on top of it.
      ctx.drawImage(videoEl, 0, 0, width, height);
      // A slight wash so the overlay stays legible over bright footage without
      // hiding what is underneath.
      ctx.fillStyle = 'rgba(250, 248, 244, 0.12)';
      ctx.fillRect(0, 0, width, height);
    } else {
      // No footage: the synthetic example, or a video not re-selected after a
      // reload. The schematic arena is drawn instead.
      ctx.fillStyle = '#f2ede5';
      ctx.fillRect(0, 0, width, height);
    }

    if (!map) return;

    // Platform.
    ctx.strokeStyle = videoEl ? '#ffd8a8' : '#cfc5b7';
    ctx.lineWidth = editRing ? 3 : 2;
    ctx.beginPath();
    ctx.arc(map.platformCenter.x, map.platformCenter.y, map.platformRadiusPx, 0, Math.PI * 2);
    ctx.stroke();

    // Holes. The target is filled; everything else is an outline, so the eye
    // goes to the one hole that matters without needing a legend.
    for (const hole of map.holes) {
      ctx.beginPath();
      ctx.arc(hole.center.x, hole.center.y, 13, 0, Math.PI * 2);
      if (hole.isTarget) {
        ctx.fillStyle = '#1d7d62';
        ctx.fill();
        ctx.strokeStyle = '#14513f';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.strokeStyle = videoEl ? '#ffd8a8' : '#b3a795';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    if (editRing) {
      // Handles stay a constant size on screen so they remain grabbable when
      // the footage is large and the canvas is CSS-scaled down.
      const scale = canvas.clientWidth > 0 ? width / canvas.clientWidth : 1;
      const knob = 5 * scale;
      ctx.strokeStyle = '#c05f3c';
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.moveTo(map.platformCenter.x - 10 * scale, map.platformCenter.y);
      ctx.lineTo(map.platformCenter.x + 10 * scale, map.platformCenter.y);
      ctx.moveTo(map.platformCenter.x, map.platformCenter.y - 10 * scale);
      ctx.lineTo(map.platformCenter.x, map.platformCenter.y + 10 * scale);
      ctx.stroke();
      for (const handle of resizeHandles(map)) {
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, knob, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#c05f3c';
        ctx.lineWidth = 1.5 * scale;
        ctx.stroke();
      }
    }

    if (!track || track.length === 0) return;

    // Trajectory, drawn as separate strokes broken by every unobserved stretch.
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let open = false;
    let lastProvenance: 'auto' | 'human' = 'auto';

    const beginStroke = (p: TrackPoint) => {
      ctx.beginPath();
      ctx.strokeStyle = p.provenance === 'human' ? '#ff8a5c' : '#4fc3f7';
      ctx.moveTo(p.body!.x, p.body!.y);
      open = true;
      lastProvenance = p.provenance;
    };

    for (const p of track) {
      if (p.state !== 'tracked' || !p.body) {
        // Unobserved. Close the current stroke and leave a visible break.
        if (open) {
          ctx.stroke();
          open = false;
        }
        continue;
      }
      if (!open) {
        beginStroke(p);
        continue;
      }
      // Provenance changed, so start a new stroke in the other colour. The
      // reviewer can then see exactly which stretch a human drew.
      if (p.provenance !== lastProvenance) {
        ctx.lineTo(p.body.x, p.body.y);
        ctx.stroke();
        beginStroke(p);
        continue;
      }
      ctx.lineTo(p.body.x, p.body.y);
    }
    if (open) ctx.stroke();

    // Mark where tracking was lost, so the breaks are explained rather than
    // just being absent. An unexplained gap looks like a rendering bug.
    ctx.fillStyle = '#b0741a';
    for (let i = 1; i < track.length; i++) {
      const prev = track[i - 1];
      const cur = track[i];
      if (!prev || !cur) continue;
      if (prev.state === 'tracked' && cur.state === 'lost' && prev.body) {
        ctx.beginPath();
        ctx.arc(prev.body.x, prev.body.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Playhead.
    if (currentFrame !== undefined) {
      const p = track[Math.min(currentFrame, track.length - 1)];
      if (p && p.body) {
        ctx.fillStyle = '#26221f';
        ctx.beginPath();
        ctx.arc(p.body.x, p.body.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }, [map, track, width, height, currentFrame, videoEl, seekTick, editRing]);

  const applyDrag = (drag: DragState, p: Point): MazeMap => {
    if (drag.mode === 'move') {
      return asManual(
        registerMap(
          drag.snapshot,
          { x: p.x - drag.grabOffset.x, y: p.y - drag.grabOffset.y },
          drag.snapshot.platformRadiusPx,
        ),
      );
    }
    if (drag.mode === 'resize') {
      const nextDist = distance(drag.snapshot.platformCenter, p);
      const scale = drag.startDist > 1 ? nextDist / drag.startDist : 1;
      const radius = Math.max(16, drag.snapshot.platformRadiusPx * scale);
      return asManual(registerMap(drag.snapshot, drag.snapshot.platformCenter, radius));
    }
    return asManual(
      rotateMap(drag.snapshot, angleAround(drag.snapshot.platformCenter, p) - drag.startAngle),
    );
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!editRing || !map) return;
    const canvas = ref.current;
    if (!canvas) return;
    const p = mazePoint(e.clientX, e.clientY, canvas, width, height);
    const slop = 14 * displayScale(canvas, width);
    const hit = hitRing(map, p, slop);
    if (hit.kind === 'none') return;
    const mode: DragState['mode'] =
      hit.kind === 'rim' ? 'resize' : hit.kind === 'hole' ? 'rotate' : 'move';
    dragRef.current = {
      mode,
      snapshot: map,
      start: p,
      moved: false,
      last: map,
      grabOffset: { x: p.x - map.platformCenter.x, y: p.y - map.platformCenter.y },
      startAngle: angleAround(map.platformCenter, p),
      startDist: distance(map.platformCenter, p),
      hole: hit.hole,
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current;
    if (!canvas || !map) return;
    const p = mazePoint(e.clientX, e.clientY, canvas, width, height);
    const scale = displayScale(canvas, width);
    const drag = dragRef.current;
    if (!drag) {
      if (editRing) setCursor(cursorFor(hitRing(map, p, 14 * scale).kind));
      return;
    }
    if (!drag.moved && distance(drag.start, p) > 4 * scale) {
      drag.moved = true;
    }
    if (!drag.moved) return;
    const next = applyDrag(drag, p);
    drag.last = next;
    setCursor(drag.mode === 'resize' ? 'nwse-resize' : 'grabbing');
    onRingPreview?.(next);
  };

  const finishDrag = (commit: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (commit && drag.moved) {
      onRingCommit?.(drag.last);
      return;
    }
    onRingPreview?.(null);
    if (commit && !drag.moved && drag.hole && onPick) {
      onPick(drag.hole.center.x, drag.hole.center.y);
    }
  };

  const handleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (editRing || !onPick) return;
    const canvas = ref.current;
    if (!canvas) return;
    // The canvas is scaled by CSS, so convert display pixels back to maze
    // coordinates before reporting the click.
    const rect = canvas.getBoundingClientRect();
    onPick(
      ((e.clientX - rect.left) / rect.width) * width,
      ((e.clientY - rect.top) / rect.height) * height,
    );
  };

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => finishDrag(true)}
      onPointerCancel={() => finishDrag(false)}
      role="img"
      aria-label={
        editRing
          ? 'Maze platform. Drag inside the ring to move it, drag the edge to resize, drag a hole to rotate. Click a hole to mark the escape.'
          : "Maze platform with the animal's path. Breaks in the path are stretches where the animal was not visible."
      }
      style={{
        cursor: editRing ? cursor : onPick ? 'crosshair' : 'default',
        touchAction: editRing ? 'none' : undefined,
        userSelect: 'none',
      }}
    />
  );
}
