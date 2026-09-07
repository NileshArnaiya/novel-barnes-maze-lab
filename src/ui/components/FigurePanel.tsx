import { useMemo, useState } from 'react';
import {
  downloadPng,
  downloadSvg,
  heatmapSvg,
  quadrantOccupancy,
  trajectorySvg,
} from '../../io/figures';
import type { VideoRecord } from '../../core/types';

/**
 * Publication figures for one trial: the trajectory and the occupancy heatmap,
 * previewed inline and exportable as vector SVG or 300 dpi PNG.
 *
 * These are the two figures a Barnes maze paper is built around, so putting
 * them one click from the numbers, rather than making the user rebuild them in
 * another tool, is most of what turns a spreadsheet into a result.
 */
export function FigurePanel({ video }: { video: VideoRecord }) {
  const [view, setView] = useState<'trajectory' | 'heatmap'>('trajectory');
  const [grayscale, setGrayscale] = useState(false);

  const track = video.track;
  const map = video.map;

  const svg = useMemo(() => {
    if (!track || !map) return '';
    return view === 'trajectory'
      ? trajectorySvg(track, map, { grayscale, size: 480 })
      : heatmapSvg(track, map, { grayscale, size: 480 });
  }, [track, map, view, grayscale]);

  const quadrants = useMemo(
    () => (track && map ? quadrantOccupancy(track, map) : null),
    [track, map],
  );

  if (!track || !map) return null;

  const base = `${video.animalId}-${view}`;

  return (
    <div className="panel">
      <h3>Figures</h3>
      <div className="row" style={{ margin: '10px 0' }}>
        <div className="row" role="tablist" aria-label="Figure type" style={{ gap: 4 }}>
          <button
            role="tab"
            aria-selected={view === 'trajectory'}
            className={view === 'trajectory' ? 'primary' : ''}
            onClick={() => setView('trajectory')}
          >
            Trajectory
          </button>
          <button
            role="tab"
            aria-selected={view === 'heatmap'}
            className={view === 'heatmap' ? 'primary' : ''}
            onClick={() => setView('heatmap')}
          >
            Occupancy heatmap
          </button>
        </div>
        <span className="grow" />
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} />
          Grayscale
        </label>
      </div>

      <div
        style={{ border: '1px solid var(--rule)', borderRadius: 8, overflow: 'hidden' }}
        // The generated SVG is our own output, built from numeric coordinates,
        // not user-supplied markup, so rendering it directly is safe here.
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      {view === 'heatmap' && quadrants ? (
        <p className="hint" style={{ marginTop: 8 }}>
          Target quadrant occupancy: {(quadrants[0]! * 100).toFixed(0)}%. Chance is 25%. Time is
          weighted by how long the animal spent in each spot, so a pause reads as a hot spot and
          a fast pass does not.
        </p>
      ) : (
        <p className="hint" style={{ marginTop: 8 }}>
          Grey marks the start, coloured the end. Breaks in the line are stretches where the
          animal was not tracked; nothing is drawn across them.
        </p>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => downloadSvg(`${base}.svg`, svg)}>Download SVG</button>
        <button onClick={() => void downloadPng(`${base}.png`, svg)}>Download PNG (300 dpi)</button>
      </div>
    </div>
  );
}
