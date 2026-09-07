import { quadrantOf } from '../core/geometry';
import type { MazeMap, TrackPoint } from '../core/types';

/**
 * Publication figures, generated as SVG.
 *
 * SVG rather than a canvas snapshot for a reason that matters to the end user:
 * a figure going into a paper needs to survive being scaled to a column width
 * and printed at 300 dpi, and a raster canvas grab pixelates when it is. SVG is
 * resolution-independent, opens in Illustrator or Inkscape for the inevitable
 * last-minute tweak, and drops into a LaTeX or Word document cleanly.
 *
 * Two figures, because they are the two every Barnes maze paper contains: the
 * trajectory over the platform, and the occupancy heatmap. Both are built from
 * the same track the measures came from, so a reader can trust that the picture
 * and the numbers describe the same trial.
 */

const INK = '#26221f';
const RULE = '#b3a795';
const TARGET = '#1d7d62';
const PATH = '#2f6f9e';

interface FigureOptions {
  /** Output size in px. SVG scales freely; this only sets the viewBox. */
  size?: number;
  /** Grayscale-safe output for journals that charge for colour figures. */
  grayscale?: boolean;
}

/** Shared frame: platform circle, holes, target marked, a scale bar. */
function platformFrame(map: MazeMap, size: number, grayscale: boolean): string {
  const scale = size / (map.platformRadiusPx * 2.3);
  const cx = size / 2;
  const cy = size / 2;
  const r = map.platformRadiusPx * scale;

  const holeColor = grayscale ? '#000' : RULE;
  const targetColor = grayscale ? '#000' : TARGET;

  let out = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${grayscale ? '#000' : RULE}" stroke-width="1.5"/>`;

  for (const hole of map.holes) {
    const hx = cx + (hole.center.x - map.platformCenter.x) * scale;
    const hy = cy + (hole.center.y - map.platformCenter.y) * scale;
    if (hole.isTarget) {
      out += `<circle cx="${hx}" cy="${hy}" r="7" fill="${grayscale ? '#000' : targetColor}" stroke="${INK}" stroke-width="1"/>`;
    } else {
      out += `<circle cx="${hx}" cy="${hy}" r="6" fill="none" stroke="${holeColor}" stroke-width="1.2"/>`;
    }
  }

  // Scale bar: 10 cm, because a figure without one is not quantitative.
  const tenCmPx = (10 * map.platformRadiusPx * 2) / map.platformDiameterCm * scale;
  const barY = size - 18;
  const barX = 18;
  out += `<line x1="${barX}" y1="${barY}" x2="${barX + tenCmPx}" y2="${barY}" stroke="${INK}" stroke-width="2"/>`;
  out += `<text x="${barX}" y="${barY - 6}" font-family="sans-serif" font-size="11" fill="${INK}">10 cm</text>`;

  return out;
}

/**
 * Trajectory figure.
 *
 * Breaks in the path where the animal was not tracked are preserved, not
 * bridged, for the same reason they are on screen: a smooth line over a dropout
 * is a claim the data does not support, and it should not be a claim a
 * published figure makes either.
 */
export function trajectorySvg(
  track: readonly TrackPoint[],
  map: MazeMap,
  options: FigureOptions = {},
): string {
  const size = options.size ?? 600;
  const grayscale = options.grayscale ?? false;
  const scale = size / (map.platformRadiusPx * 2.3);
  const cx = size / 2;
  const cy = size / 2;

  const toX = (x: number) => cx + (x - map.platformCenter.x) * scale;
  const toY = (y: number) => cy + (y - map.platformCenter.y) * scale;

  // Build path segments, starting a new one after every gap.
  const segments: string[] = [];
  let current = '';
  for (const p of track) {
    if (p.state !== 'tracked' || !p.body) {
      if (current) {
        segments.push(current);
        current = '';
      }
      continue;
    }
    const cmd = current ? 'L' : 'M';
    current += `${cmd}${toX(p.body.x).toFixed(1)} ${toY(p.body.y).toFixed(1)} `;
  }
  if (current) segments.push(current);

  const pathColor = grayscale ? '#444' : PATH;
  const paths = segments
    .map((d) => `<path d="${d}" fill="none" stroke="${pathColor}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`)
    .join('');

  // Start and end markers, so direction is readable.
  const first = track.find((p) => p.state === 'tracked' && p.body);
  const last = [...track].reverse().find((p) => p.state === 'tracked' && p.body);
  let markers = '';
  if (first?.body) markers += `<circle cx="${toX(first.body.x)}" cy="${toY(first.body.y)}" r="5" fill="${grayscale ? '#888' : '#8a8a8a'}"/>`;
  if (last?.body) markers += `<circle cx="${toX(last.body.x)}" cy="${toY(last.body.y)}" r="5" fill="${grayscale ? '#000' : PATH}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" fill="#ffffff"/>
${platformFrame(map, size, grayscale)}
${paths}
${markers}
</svg>`;
}

/**
 * Occupancy heatmap.
 *
 * A 2D histogram of where the animal spent time, smoothed and drawn as a
 * density over the platform. On a probe trial this is the figure that shows
 * memory: an animal that learned concentrates its search in the target
 * quadrant, and the heatmap makes that visible in a way a latency number
 * cannot.
 *
 * Time-weighted: each frame contributes the real time to the next frame, so a
 * pause reads as a hot spot and a fast traverse does not. Counting frames
 * instead would let a high frame rate masquerade as long occupancy.
 */
export function heatmapSvg(
  track: readonly TrackPoint[],
  map: MazeMap,
  options: FigureOptions = {},
): string {
  const size = options.size ?? 600;
  const grayscale = options.grayscale ?? false;
  const bins = 40;
  const scale = size / (map.platformRadiusPx * 2.3);
  const cx = size / 2;
  const cy = size / 2;

  // Accumulate time in a coarse grid over the platform bounding box.
  const grid = new Float64Array(bins * bins);
  const minX = map.platformCenter.x - map.platformRadiusPx;
  const minY = map.platformCenter.y - map.platformRadiusPx;
  const span = map.platformRadiusPx * 2;

  for (let i = 0; i < track.length - 1; i++) {
    const p = track[i];
    const next = track[i + 1];
    if (!p || !next || p.state !== 'tracked' || !p.body) continue;
    const dt = next.t - p.t;
    if (dt <= 0) continue;
    const gx = Math.floor(((p.body.x - minX) / span) * bins);
    const gy = Math.floor(((p.body.y - minY) / span) * bins);
    if (gx < 0 || gy < 0 || gx >= bins || gy >= bins) continue;
    grid[gy * bins + gx] = (grid[gy * bins + gx] ?? 0) + dt;
  }

  // Light box blur so the density reads as a field rather than a pixel grid.
  const blurred = new Float64Array(bins * bins);
  for (let y = 0; y < bins; y++) {
    for (let x = 0; x < bins; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= bins || ny >= bins) continue;
          sum += grid[ny * bins + nx] ?? 0;
          count++;
        }
      }
      blurred[y * bins + x] = count ? sum / count : 0;
    }
  }

  let max = 0;
  for (const v of blurred) if (v > max) max = v;
  if (max <= 0) max = 1;

  // Colour ramp: viridis-like, which is perceptually uniform and readable in
  // grayscale, the property that makes it the field standard for heatmaps.
  const color = (t: number): string => {
    if (grayscale) {
      const g = Math.round(255 * (1 - t));
      return `rgb(${g},${g},${g})`;
    }
    // Cheap viridis approximation across five stops.
    const stops = [
      [68, 1, 84],
      [59, 82, 139],
      [33, 145, 140],
      [94, 201, 98],
      [253, 231, 37],
    ];
    const seg = Math.min(3, Math.max(0, Math.floor(t * 4)));
    const local = t * 4 - seg;
    const a = stops[seg] ?? stops[0]!;
    const b = stops[seg + 1] ?? stops[4]!;
    const mix = (i: number) => Math.round((a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * local);
    return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
  };

  const cell = (span * scale) / bins;
  let cells = '';
  for (let y = 0; y < bins; y++) {
    for (let x = 0; x < bins; x++) {
      const v = (blurred[y * bins + x] ?? 0) / max;
      if (v < 0.02) continue;
      const px = cx + (minX + (x / bins) * span - map.platformCenter.x) * scale;
      const py = cy + (minY + (y / bins) * span - map.platformCenter.y) * scale;
      cells += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${(cell + 0.5).toFixed(1)}" height="${(cell + 0.5).toFixed(1)}" fill="${color(v)}" opacity="${(0.35 + v * 0.65).toFixed(2)}"/>`;
    }
  }

  // Clip the density to the platform so it does not bleed into the surround.
  const r = map.platformRadiusPx * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" fill="#ffffff"/>
<defs><clipPath id="platform"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
<g clip-path="url(#platform)">${cells}</g>
${platformFrame(map, size, grayscale)}
</svg>`;
}

/** Download an SVG string as a file. */
export function downloadSvg(filename: string, svg: string): void {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Rasterise an SVG to a high-resolution PNG, for journals that will not take
 * vector art. 3x scale gives roughly 300 dpi at a typical figure size.
 */
export async function svgToPng(svg: string, scale = 3): Promise<Blob> {
  const match = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const w = match ? Number(match[1]) : 600;
  const h = match ? Number(match[2]) : 600;

  const img = new Image();
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not rasterise the figure.'));
      img.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a canvas context.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export async function downloadPng(filename: string, svg: string): Promise<void> {
  const blob = await svgToPng(svg);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fraction of time in each quadrant, target first. For the figure caption. */
export function quadrantOccupancy(track: readonly TrackPoint[], map: MazeMap): number[] {
  const time = [0, 0, 0, 0];
  for (let i = 0; i < track.length - 1; i++) {
    const p = track[i];
    const next = track[i + 1];
    if (!p || !next || p.state !== 'tracked' || !p.body) continue;
    const q = quadrantOf(map, p.body);
    if (q >= 0 && q < 4) time[q] = (time[q] ?? 0) + (next.t - p.t);
  }
  const total = time.reduce((a, b) => a + b, 0) || 1;
  return time.map((t) => t / total);
}
