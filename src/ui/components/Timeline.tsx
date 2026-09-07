import { useEffect, useRef } from 'react';
import type { MazeEvent, TrackPoint } from '../../core/types';

/**
 * The trial timeline.
 *
 * One horizontal strip showing, at a glance, what happened and where the data
 * is trustworthy. Clicking anywhere scrubs there, which is what turns "the
 * error count is 7" into "show me error number 4".
 *
 * The tracking-state band is drawn under the events deliberately: a user should
 * see immediately whether an event sits on solid data or next to a gap.
 */

interface Props {
  track: readonly TrackPoint[];
  events: readonly MazeEvent[];
  currentFrame: number;
  onSeek: (frame: number) => void;
}

const H = 58;

export function Timeline({ track, events, currentFrame, onSeek }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || track.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    ctx.clearRect(0, 0, W, H);
    const px = W / track.length;

    // Band 1: tracking state, one thin column per frame.
    for (let i = 0; i < track.length; i++) {
      const p = track[i];
      if (!p) continue;
      if (p.state === 'tracked') ctx.fillStyle = p.provenance === 'human' ? '#c05f3c' : '#cfe0ea';
      else if (p.state === 'lost') ctx.fillStyle = '#f0d9a8';
      else ctx.fillStyle = '#bfe0d2';
      ctx.fillRect(i * px, 0, Math.max(1, px), 20);
    }

    // Band 2: events. Investigations are ticks; the escape is a full bar,
    // because it is the one event that ends the trial.
    ctx.fillRect(0, 22, W, 0);
    for (const e of events) {
      const x = (e.startFrame / track.length) * W;
      const w = Math.max(2, ((e.endFrame - e.startFrame) / track.length) * W);
      if (e.kind === 'escape') {
        ctx.fillStyle = '#1d7d62';
        ctx.fillRect(x - 1, 24, 3, 30);
      } else if (e.kind === 'reached-target') {
        ctx.fillStyle = '#1d7d62';
        ctx.fillRect(x - 1, 24, 2, 18);
      } else {
        ctx.fillStyle = e.isTargetHole ? '#1d7d62' : '#b3a795';
        ctx.fillRect(x, 30, w, 12);
      }
    }

    // Playhead.
    const hx = (currentFrame / track.length) * W;
    ctx.strokeStyle = '#26221f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx, 0);
    ctx.lineTo(hx, H);
    ctx.stroke();
  }, [track, events, currentFrame]);

  const seekFromEvent = (clientX: number) => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(Math.floor(frac * (track.length - 1)));
  };

  return (
    <canvas
      ref={ref}
      className="timeline"
      width={1000}
      height={H}
      onClick={(e) => seekFromEvent(e.clientX)}
      role="slider"
      tabIndex={0}
      aria-label="Trial timeline. Left and right arrows step one frame."
      aria-valuemin={0}
      aria-valuemax={Math.max(0, track.length - 1)}
      aria-valuenow={currentFrame}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentFrame - 1));
        if (e.key === 'ArrowRight') onSeek(Math.min(track.length - 1, currentFrame + 1));
      }}
    />
  );
}
