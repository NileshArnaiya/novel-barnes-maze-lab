import { useMemo, useState } from 'react';
import {
  downloadPng,
  downloadSvg,
  heatmapSvg,
  holeVisitRasterSvg,
  quadrantOccupancy,
  timeColoredPathSvg,
  trajectorySvg,
} from '../../io/figures';
import type { VideoRecord } from '../../core/types';

type FigureView = 'trajectory' | 'time' | 'heatmap' | 'raster';

/**
 * Per-trial figures: trajectory, time-coloured path, heatmap, hole visits.
 */
export function FigurePanel({ video }: { video: VideoRecord }) {
  const [view, setView] = useState<FigureView>('trajectory');
  const [grayscale, setGrayscale] = useState(false);

  const track = video.track;
  const map = video.map;
  const events = video.events ?? [];

  const svg = useMemo(() => {
    if (!track || !map) return '';
    if (view === 'trajectory') return trajectorySvg(track, map, { grayscale, size: 480 });
    if (view === 'time') return timeColoredPathSvg(track, map, { grayscale, size: 480 });
    if (view === 'heatmap') return heatmapSvg(track, map, { grayscale, size: 480 });
    return holeVisitRasterSvg(events, map, video.durationS, { grayscale, width: 560 });
  }, [track, map, events, view, grayscale, video.durationS]);

  const quadrants = useMemo(
    () => (track && map ? quadrantOccupancy(track, map) : null),
    [track, map],
  );

  if (!track || !map) return null;

  const base = `${video.animalId}-${view}`;
  const tabs: { id: FigureView; label: string }[] = [
    { id: 'trajectory', label: 'Trajectory' },
    { id: 'time', label: 'Time-colored' },
    { id: 'heatmap', label: 'Occupancy heatmap' },
    { id: 'raster', label: 'Hole visits' },
  ];

  const caption =
    view === 'heatmap' && quadrants
      ? `Target quadrant occupancy: ${(quadrants[0]! * 100).toFixed(0)}%. Chance is 25%. Time is weighted by how long the animal spent in each spot, so a pause reads as a hot spot and a fast pass does not.`
      : view === 'time'
        ? 'Colour runs from start (purple) to end (yellow). Breaks in the line are stretches where the animal was not tracked; nothing is drawn across them.'
        : view === 'raster'
          ? 'Time runs left to right, holes top to bottom. Bars are investigations. The triangle is first reach of the target; the filled circle is the escape. The target row is shaded.'
          : 'Grey marks the start, coloured the end. Breaks in the line are stretches where the animal was not tracked; nothing is drawn across them.';

  return (
    <div className="panel">
      <h3>Figures</h3>
      <div className="row" style={{ margin: '10px 0' }}>
        <div className="row" role="tablist" aria-label="Figure type" style={{ gap: 4, flexWrap: 'wrap' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={view === tab.id}
              className={view === tab.id ? 'primary' : ''}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} />
          Grayscale
        </label>
      </div>

      <div
        style={{ border: '1px solid var(--rule)', borderRadius: 8, overflow: 'hidden' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <p className="hint" style={{ marginTop: 8 }}>
        {caption}
      </p>

      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => downloadSvg(`${base}.svg`, svg)}>Download SVG</button>
        <button onClick={() => void downloadPng(`${base}.png`, svg)}>Download PNG (300 dpi)</button>
      </div>
    </div>
  );
}
