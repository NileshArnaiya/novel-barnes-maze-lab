import {
  animalDayValues,
  cohorts,
  CURVE_MEASURES,
  learningCurve,
  strategyByDay,
  type CurveMeasure,
} from '../core/aggregate';
import { quadrantOf } from '../core/geometry';
import type { MazeEvent, MazeMap, Project, StrategyLabel, TrackPoint } from '../core/types';

/**
 * SVG figures from the same track as the numbers.
 */

const INK = '#26221f';
const RULE = '#b3a795';
const TARGET = '#1d7d62';
const PATH = '#2f6f9e';

interface FigureOptions {
  /** Output size in px. SVG scales; this only sets the viewBox. */
  size?: number;
  /** Grayscale for journals that will not take colour. */
  grayscale?: boolean;
}

/** Escape text for SVG. Filenames can contain `&`. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Viridis-like ramp, 0..1. Shared by heatmap and time-coloured path. */
function ramp(t: number, grayscale: boolean): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (grayscale) {
    // Light → dark so later in the trial reads as darker on white paper.
    const g = Math.round(220 - 200 * clamped);
    return `rgb(${g},${g},${g})`;
  }
  const stops = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const seg = Math.min(3, Math.max(0, Math.floor(clamped * 4)));
  const local = clamped * 4 - seg;
  const a = stops[seg] ?? stops[0]!;
  const b = stops[seg + 1] ?? stops[4]!;
  const mix = (i: number) => Math.round((a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * local);
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

/** Colour bar with end labels. */
function colorbar(
  x: number,
  y: number,
  width: number,
  grayscale: boolean,
  leftLabel: string,
  rightLabel: string,
  caption: string,
): string {
  const steps = 40;
  const w = width / steps;
  let out = '';
  for (let i = 0; i < steps; i++) {
    out += `<rect x="${(x + i * w).toFixed(1)}" y="${y}" width="${(w + 0.6).toFixed(
      1,
    )}" height="9" fill="${ramp(i / (steps - 1), grayscale)}"/>`;
  }
  out += `<rect x="${x}" y="${y}" width="${width}" height="9" fill="none" stroke="${RULE}" stroke-width="0.7"/>`;
  out += `<text x="${x}" y="${y + 22}" font-family="sans-serif" font-size="10" fill="${INK}">${esc(
    leftLabel,
  )}</text>`;
  out += `<text x="${x + width}" y="${
    y + 22
  }" font-family="sans-serif" font-size="10" fill="${INK}" text-anchor="end">${esc(
    rightLabel,
  )}</text>`;
  out += `<text x="${x + width / 2}" y="${
    y + 22
  }" font-family="sans-serif" font-size="10" fill="${INK}" text-anchor="middle">${esc(
    caption,
  )}</text>`;
  return out;
}

/** Platform, holes, target, 10 cm scale bar. */
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

  // 10 cm scale bar.
  const tenCmPx = (10 * map.platformRadiusPx * 2) / map.platformDiameterCm * scale;
  const barY = size - 18;
  const barX = 18;
  out += `<line x1="${barX}" y1="${barY}" x2="${barX + tenCmPx}" y2="${barY}" stroke="${INK}" stroke-width="2"/>`;
  out += `<text x="${barX}" y="${barY - 6}" font-family="sans-serif" font-size="11" fill="${INK}">10 cm</text>`;

  return out;
}

/**
 * Path over the platform. Gaps stay gaps — never a line across lost frames.
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

  // New path after every gap.
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

  // Start (grey) and end (filled).
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
 * Occupancy heatmap. Time-weighted: a pause is hot, a fast pass is not.
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

  // Time spent per bin over the platform.
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

  // Light blur so it reads as a field, not a grid.
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

  const color = (t: number): string => ramp(t, grayscale);

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

  // Clip to the platform. Unique id so inlined SVGs do not steal each other's clip.
  const clipId = `barnes-platform-${size}-${Math.round(cx)}-${Math.round(cy)}`;
  const r = map.platformRadiusPx * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" fill="#ffffff"/>
<defs><clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
<g clip-path="url(#${clipId})">${cells}</g>
${platformFrame(map, size, grayscale)}
</svg>`;
}

/**
 * Path coloured by time. Consecutive tracked frames only — a gap is a break.
 */
export function timeColoredPathSvg(
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

  let tMax = 0;
  for (const p of track) if (p.state === 'tracked' && p.body && p.t > tMax) tMax = p.t;
  if (tMax <= 0) tMax = 1;

  let lines = '';
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (!a || !b || a.state !== 'tracked' || b.state !== 'tracked' || !a.body || !b.body) continue;
    const t = (a.t + b.t) / 2 / tMax;
    lines += `<line x1="${toX(a.body.x).toFixed(1)}" y1="${toY(a.body.y).toFixed(1)}" x2="${toX(
      b.body.x,
    ).toFixed(1)}" y2="${toY(b.body.y).toFixed(1)}" stroke="${ramp(t, grayscale)}" stroke-width="2" stroke-linecap="round"/>`;
  }

  const first = track.find((p) => p.state === 'tracked' && p.body);
  const last = [...track].reverse().find((p) => p.state === 'tracked' && p.body);
  let markers = '';
  if (first?.body)
    markers += `<circle cx="${toX(first.body.x)}" cy="${toY(first.body.y)}" r="5" fill="${grayscale ? '#888' : '#8a8a8a'}"/>`;
  if (last?.body)
    markers += `<circle cx="${toX(last.body.x)}" cy="${toY(last.body.y)}" r="5" fill="${ramp(1, grayscale)}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" fill="#ffffff"/>
${platformFrame(map, size, grayscale)}
${lines}
${markers}
${colorbar(size - 168, 16, 140, grayscale, 'start', 'end', 'time')}
</svg>`;
}

/**
 * Hole visits: time left-to-right, holes top-to-bottom.
 * Bars = investigations. Triangle = first reach. Circle = escape.
 */
export function holeVisitRasterSvg(
  events: readonly MazeEvent[],
  map: MazeMap,
  durationS: number,
  options: FigureOptions & { width?: number } = {},
): string {
  const width = options.width ?? 720;
  const grayscale = options.grayscale ?? false;
  const holes = [...map.holes].sort((a, b) => a.index - b.index);
  const n = Math.max(1, holes.length);
  const padL = 72;
  const padR = 16;
  const padT = 28;
  const padB = 48;
  const rowH = 18;
  const height = padT + n * rowH + padB;
  const innerW = width - padL - padR;
  const tMax = Math.max(durationS, ...events.map((e) => e.endT), 0.001);
  const xOf = (t: number) => padL + (t / tMax) * innerW;
  const yRow = (index: number) => padT + index * rowH;

  const targetFill = grayscale ? '#e8e8e8' : '#e7f3ee';
  const barFill = grayscale ? '#555' : PATH;
  const targetBar = grayscale ? '#111' : TARGET;
  const reachFill = grayscale ? '#000' : '#c05f3c';

  let rows = '';
  for (const hole of holes) {
    const y = yRow(hole.index);
    if (hole.isTarget) {
      rows += `<rect x="${padL}" y="${y}" width="${innerW}" height="${rowH}" fill="${targetFill}"/>`;
    }
    rows += `<line x1="${padL}" y1="${y + rowH}" x2="${width - padR}" y2="${y + rowH}" stroke="#efe9df" stroke-width="1"/>`;
    const label = hole.isTarget ? `${hole.index} target` : String(hole.index);
    rows += `<text x="${padL - 8}" y="${y + rowH * 0.7}" text-anchor="end" font-family="sans-serif" font-size="11" fill="${INK}">${esc(label)}</text>`;
  }

  let bars = '';
  for (const e of events) {
    if (e.kind !== 'investigation' || e.holeIndex === null) continue;
    const y = yRow(e.holeIndex) + 3;
    const x0 = xOf(e.startT);
    const x1 = Math.max(xOf(e.endT), x0 + 2);
    const fill = e.isTargetHole ? targetBar : barFill;
    bars += `<rect x="${x0.toFixed(1)}" y="${y}" width="${(x1 - x0).toFixed(1)}" height="${rowH - 6}" fill="${fill}" rx="1"/>`;
  }

  let marks = '';
  for (const e of events) {
    if (e.kind !== 'reached-target' && e.kind !== 'escape') continue;
    const idx = e.holeIndex ?? holes.find((h) => h.isTarget)?.index ?? 0;
    const cxm = xOf(e.startT);
    const cy = yRow(idx) + rowH / 2;
    if (e.kind === 'reached-target') {
      marks += `<polygon points="${cxm.toFixed(1)},${(cy - 6).toFixed(1)} ${(cxm + 5).toFixed(1)},${(cy + 5).toFixed(1)} ${(cxm - 5).toFixed(1)},${(cy + 5).toFixed(1)}" fill="${reachFill}"/>`;
    } else {
      marks += `<circle cx="${cxm.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${targetBar}" stroke="${INK}" stroke-width="1"/>`;
    }
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const tx = xOf(tMax * f);
    return `<line x1="${tx.toFixed(1)}" y1="${padT + n * rowH}" x2="${tx.toFixed(1)}" y2="${padT + n * rowH + 4}" stroke="${RULE}"/>
<text x="${tx.toFixed(1)}" y="${padT + n * rowH + 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${INK}">${(tMax * f).toFixed(tMax < 20 ? 1 : 0)}s</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<rect width="${width}" height="${height}" fill="#ffffff"/>
${rows}
${bars}
${marks}
${ticks.join('')}
<text x="${(padL + width - padR) / 2}" y="${height - 10}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${INK}">Time (s)</text>
<text x="14" y="${padT + (n * rowH) / 2}" font-family="sans-serif" font-size="12" fill="${INK}" transform="rotate(-90 14 ${padT + (n * rowH) / 2})" text-anchor="middle">Hole</text>
</svg>`;
}

const COHORT_COLORS = ['#c05f3c', '#1d7d62', '#b0741a', '#4a5c8a', '#8a4a6f'];
const STRATEGY_COLORS: Record<StrategyLabel, string> = {
  spatial: '#1d7d62',
  serial: '#b0741a',
  random: '#c05f3c',
  undetermined: '#8a8a8a',
};

function axisChart(
  width: number,
  height: number,
  padL: number,
  padR: number,
  padT: number,
  padB: number,
  days: number[],
  maxVal: number,
  yLabel: string,
): { x: (day: number) => number; y: (val: number) => number; chrome: string } {
  const minDay = days[0] ?? 0;
  const maxDay = days[days.length - 1] ?? 1;
  const x = (day: number) =>
    padL + ((day - minDay) / (maxDay - minDay || 1)) * (width - padL - padR);
  const y = (val: number) => height - padB - (val / (maxVal || 1)) * (height - padT - padB);
  let chrome = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" stroke="#cfc5b7" stroke-width="1"/>`;
  chrome += `<line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="#cfc5b7" stroke-width="1"/>`;
  for (const f of [0, 0.5, 1]) {
    chrome += `<text x="${padL - 8}" y="${y(maxVal * f) + 4}" text-anchor="end" font-family="sans-serif" font-size="11" fill="#5f574f">${(maxVal * f).toFixed(maxVal < 10 ? 1 : 0)}</text>`;
    chrome += `<line x1="${padL}" y1="${y(maxVal * f)}" x2="${width - padR}" y2="${y(maxVal * f)}" stroke="#efe9df" stroke-width="1"/>`;
  }
  chrome += `<text x="16" y="${height / 2}" font-family="sans-serif" font-size="12" fill="${INK}" transform="rotate(-90 16 ${height / 2})" text-anchor="middle">${esc(yLabel)}</text>`;
  for (const d of days) {
    chrome += `<text x="${x(d)}" y="${height - padB + 18}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#5f574f">${d}</text>`;
  }
  chrome += `<text x="${(padL + width - padR) / 2}" y="${height - 6}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${INK}">Training day</text>`;
  return { x, y, chrome };
}

/**
 * Learning curve SVG. Null if there are not two days. Error bars are SEM.
 */
export function learningCurveSvg(
  project: Project,
  measure: CurveMeasure,
  options: { width?: number; height?: number } = {},
): string | null {
  const points = learningCurve(project, measure);
  const groups = cohorts(project);
  const days = [...new Set(points.map((p) => p.day))].sort((a, b) => a - b);
  if (days.length < 2) return null;

  const spec = CURVE_MEASURES.find((m) => m.key === measure)!;
  const W = options.width ?? 620;
  const H = options.height ?? 340;
  const padL = 54;
  const padR = 130;
  const padB = 44;
  const padT = 20;
  const maxVal = Math.max(...points.map((p) => p.mean + p.sem), 1);
  const { x, y, chrome } = axisChart(
    W,
    H,
    padL,
    padR,
    padT,
    padB,
    days,
    maxVal,
    spec.unit ? `${spec.label} (${spec.unit})` : spec.label,
  );

  let body = '';
  groups.forEach((cohort, ci) => {
    const color = COHORT_COLORS[ci % COHORT_COLORS.length]!;
    const cp = points.filter((p) => p.cohort === cohort && p.n > 0);
    if (cp.length === 0) return;
    const d = cp.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)} ${y(p.mean).toFixed(1)}`).join(' ');
    body += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`;
    for (const p of cp) {
      body += `<line x1="${x(p.day)}" y1="${y(p.mean - p.sem)}" x2="${x(p.day)}" y2="${y(p.mean + p.sem)}" stroke="${color}" stroke-width="1.5"/>`;
      body += `<line x1="${x(p.day) - 4}" y1="${y(p.mean + p.sem)}" x2="${x(p.day) + 4}" y2="${y(p.mean + p.sem)}" stroke="${color}" stroke-width="1.5"/>`;
      body += `<line x1="${x(p.day) - 4}" y1="${y(p.mean - p.sem)}" x2="${x(p.day) + 4}" y2="${y(p.mean - p.sem)}" stroke="${color}" stroke-width="1.5"/>`;
      body += `<circle cx="${x(p.day)}" cy="${y(p.mean)}" r="4" fill="${color}"/>`;
    }
    body += `<circle cx="${W - padR + 16}" cy="${padT + 6 + ci * 20}" r="4" fill="${color}"/>`;
    body += `<text x="${W - padR + 26}" y="${padT + 10 + ci * 20}" font-family="sans-serif" font-size="12" fill="${INK}">${esc(cohort)}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#ffffff"/>
${chrome}
${body}
</svg>`;
}

/** Faint animal lines, bold cohort mean ± SEM. */
export function cohortComparisonSvg(
  project: Project,
  measure: CurveMeasure,
  options: { width?: number; height?: number } = {},
): string | null {
  const points = learningCurve(project, measure);
  const groups = cohorts(project);
  const days = [...new Set(points.map((p) => p.day))].sort((a, b) => a - b);
  if (days.length < 2 && groups.length < 2) return null;
  if (days.length === 0) return null;

  const spec = CURVE_MEASURES.find((m) => m.key === measure)!;
  const animals = animalDayValues(project, measure);
  const W = options.width ?? 620;
  const H = options.height ?? 340;
  const padL = 54;
  const padR = 130;
  const padB = 44;
  const padT = 20;
  const maxVal = Math.max(
    ...points.map((p) => p.mean + p.sem),
    ...animals.map((a) => a.value),
    1,
  );
  const { x, y, chrome } = axisChart(
    W,
    H,
    padL,
    padR,
    padT,
    padB,
    days,
    maxVal,
    spec.unit ? `${spec.label} (${spec.unit})` : spec.label,
  );

  let body = '';
  groups.forEach((cohort, ci) => {
    const color = COHORT_COLORS[ci % COHORT_COLORS.length]!;
    const ids = [...new Set(animals.filter((a) => a.cohort === cohort).map((a) => a.animalId))];
    for (const id of ids) {
      const seq = animals
        .filter((a) => a.cohort === cohort && a.animalId === id)
        .sort((a, b) => a.day - b.day);
      if (seq.length === 0) continue;
      const d = seq.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
      body += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1" opacity="0.35"/>`;
    }
    const cp = points.filter((p) => p.cohort === cohort && p.n > 0);
    if (cp.length > 0) {
      const d = cp.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)} ${y(p.mean).toFixed(1)}`).join(' ');
      body += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4"/>`;
      for (const p of cp) {
        body += `<line x1="${x(p.day)}" y1="${y(p.mean - p.sem)}" x2="${x(p.day)}" y2="${y(p.mean + p.sem)}" stroke="${color}" stroke-width="1.5"/>`;
        body += `<circle cx="${x(p.day)}" cy="${y(p.mean)}" r="4" fill="${color}"/>`;
      }
    }
    body += `<circle cx="${W - padR + 16}" cy="${padT + 6 + ci * 20}" r="4" fill="${color}"/>`;
    body += `<text x="${W - padR + 26}" y="${padT + 10 + ci * 20}" font-family="sans-serif" font-size="12" fill="${INK}">${esc(cohort)}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#ffffff"/>
${chrome}
${body}
</svg>`;
}

/** Stacked strategy counts by day. */
export function strategyByDaySvg(
  project: Project,
  options: { width?: number; height?: number } = {},
): string | null {
  const groups = cohorts(project);
  if (groups.length === 0) return null;
  const allDays = new Set<number>();
  const data = groups.map((c) => {
    const rows = strategyByDay(project, c);
    for (const r of rows) allDays.add(r.day);
    return { cohort: c, rows };
  });
  const days = [...allDays].sort((a, b) => a - b);
  if (days.length === 0) return null;

  const W = options.width ?? 620;
  const H = options.height ?? 340;
  const padL = 54;
  const padR = 150;
  const padB = 44;
  const padT = 20;
  const labels: StrategyLabel[] = ['spatial', 'serial', 'random', 'undetermined'];
  let maxN = 1;
  for (const g of data) {
    for (const r of g.rows) {
      const n = labels.reduce((s, k) => s + r.counts[k], 0);
      if (n > maxN) maxN = n;
    }
  }
  const { x, y, chrome } = axisChart(W, H, padL, padR, padT, padB, days, maxN, 'Trials');
  const cluster = Math.max(8, ((W - padL - padR) / Math.max(days.length, 1)) * 0.5);
  const barW = Math.max(6, cluster / groups.length - 2);

  let body = '';
  groups.forEach((_cohort, ci) => {
    const g = data[ci]!;
    for (const r of g.rows) {
      const cx = x(r.day) - cluster / 2 + ci * barW + barW / 2;
      let acc = 0;
      for (const lab of labels) {
        const n = r.counts[lab];
        if (n <= 0) continue;
        const y1 = y(acc + n);
        const y0 = y(acc);
        body += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${barW.toFixed(1)}" height="${(y0 - y1).toFixed(1)}" fill="${STRATEGY_COLORS[lab]}"/>`;
        acc += n;
      }
    }
  });

  labels.forEach((lab, i) => {
    body += `<rect x="${W - padR + 12}" y="${padT + i * 18}" width="10" height="10" fill="${STRATEGY_COLORS[lab]}"/>`;
    body += `<text x="${W - padR + 28}" y="${padT + 10 + i * 18}" font-family="sans-serif" font-size="12" fill="${INK}">${lab}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#ffffff"/>
${chrome}
${body}
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

/** Rasterise SVG to PNG. Default 3× ≈ 300 dpi at typical figure size. */
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

/** Time in each quadrant, target first. For the caption. */
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
