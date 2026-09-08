import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { hasCohortSpan } from '../core/aggregate';
import type { Project, VideoRecord } from '../core/types';
import {
  cohortComparisonSvg,
  heatmapSvg,
  holeVisitRasterSvg,
  learningCurveSvg,
  strategyByDaySvg,
  svgToPng,
  timeColoredPathSvg,
} from './figures';
import { methodsText } from './workbook';

/**
 * PDF report from the same figures and tables as Export.
 * Images are PNG rasters of the SVGs. Without a rasteriser, tables still write.
 */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const INK = rgb(0.15, 0.13, 0.12);
const MUTED = rgb(0.37, 0.34, 0.31);
const RULE = rgb(0.7, 0.65, 0.58);

export type Rasterizer = (svg: string) => Promise<Uint8Array>;

export async function browserRasterizer(svg: string): Promise<Uint8Array> {
  const blob = await svgToPng(svg, 2);
  return new Uint8Array(await blob.arrayBuffer());
}

interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  rasterize?: Rasterizer;
}

function addPage(doc: PDFDocument): PDFPage {
  return doc.addPage([PAGE_W, PAGE_H]);
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawFooter(page: PDFPage, font: PDFFont, label: string): void {
  page.drawText(label, {
    x: MARGIN,
    y: 24,
    size: 8,
    font,
    color: MUTED,
  });
}

function drawHeading(page: PDFPage, font: PDFFont, text: string, y: number, size = 16): number {
  page.drawText(text, { x: MARGIN, y, size, font, color: INK });
  page.drawLine({
    start: { x: MARGIN, y: y - 6 },
    end: { x: PAGE_W - MARGIN, y: y - 6 },
    thickness: 0.6,
    color: RULE,
  });
  return y - 22;
}

async function drawSvg(
  ctx: Ctx,
  page: PDFPage,
  svg: string,
  x: number,
  yTop: number,
  maxW: number,
  maxH: number,
): Promise<number> {
  if (!ctx.rasterize) return yTop;
  try {
    const png = await ctx.rasterize(svg);
    const img = await ctx.doc.embedPng(png);
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x, y: yTop - h, width: w, height: h });
    return yTop - h - 10;
  } catch {
    return yTop;
  }
}

function drawTable(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  headers: string[],
  rows: string[][],
  yStart: number,
  colWidths: number[],
): number {
  let y = yStart;
  const size = 8;
  const rowH = 12;
  let x = MARGIN;
  headers.forEach((h, i) => {
    page.drawText(h, { x, y, size, font: bold, color: INK });
    x += colWidths[i] ?? 60;
  });
  y -= 4;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5,
    color: RULE,
  });
  y -= rowH;
  for (const row of rows) {
    if (y < 48) break;
    x = MARGIN;
    row.forEach((cell, i) => {
      const w = colWidths[i] ?? 60;
      let text = cell;
      while (text.length > 1 && font.widthOfTextAtSize(text, size) > w - 4) {
        text = text.slice(0, -1);
      }
      page.drawText(text, { x, y, size, font, color: INK });
      x += w;
    });
    y -= rowH;
  }
  return y;
}

function scored(project: Project): VideoRecord[] {
  return project.videos.filter((v) => v.summary && v.map && v.track);
}

export async function buildReportPdf(
  project: Project,
  rasterize?: Rasterizer,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, font, bold, rasterize };
  const trials = scored(project);
  const stamp = new Date().toISOString().slice(0, 10);

  // Cover
  {
    const page = addPage(doc);
    let y = PAGE_H - MARGIN;
    page.drawText('Barnes maze report', { x: MARGIN, y, size: 22, font: bold, color: INK });
    y -= 28;
    page.drawText(`Exported ${stamp}  ·  ${project.toolVersion}`, {
      x: MARGIN,
      y,
      size: 11,
      font,
      color: MUTED,
    });
    y -= 28;
    const nAnimals = new Set(trials.map((v) => v.summary!.animalId)).size;
    page.drawText(
      `${trials.length} scored trial${trials.length === 1 ? '' : 's'} from ${nAnimals} animal${
        nAnimals === 1 ? '' : 's'
      }. ${project.videos.length - trials.length} not yet scored.`,
      { x: MARGIN, y, size: 11, font, color: INK },
    );
    y -= 24;
    y = drawHeading(page, bold, 'Methods', y);
    for (const para of methodsText(project).split('\n\n')) {
      const lines = wrap(para, font, 10, PAGE_W - 2 * MARGIN);
      for (const line of lines) {
        if (y < 48) break;
        page.drawText(line, { x: MARGIN, y, size: 10, font, color: INK });
        y -= 13;
      }
      y -= 8;
    }
    drawFooter(page, font, 'Gaps in tracking are never interpolated.');
  }

  // Parameters
  {
    const page = addPage(doc);
    let y = drawHeading(page, bold, 'Parameters', PAGE_H - MARGIN);
    const rows: string[][] = [
      ['tool_version', project.toolVersion],
      ['gap_handling', 'skipped, not interpolated'],
    ];
    for (const [k, v] of Object.entries(project.params)) rows.push([k, String(v)]);
    drawTable(page, font, bold, ['parameter', 'value'], rows, y, [280, 230]);
    drawFooter(page, font, 'Same thresholds as barnes-parameters.csv');
  }

  // Measurements
  {
    const page = addPage(doc);
    let y = drawHeading(page, bold, 'Measurements', PAGE_H - MARGIN);
    const headers = ['animal', 'cohort', 'day', 'reached', 'lat_s', 'err', 'path_cm', 'strategy'];
    const widths = [70, 70, 36, 50, 48, 36, 58, 70];
    const rows = trials.map((v) => {
      const s = v.summary!;
      return [
        s.animalId,
        s.cohort,
        s.day === null ? '' : String(s.day),
        s.primaryLatencyS === null ? 'no' : 'yes',
        s.primaryLatencyS === null ? '' : s.primaryLatencyS.toFixed(1),
        String(s.primaryErrors),
        s.pathLengthCm.toFixed(0),
        s.strategy.label,
      ];
    });
    drawTable(page, font, bold, headers, rows, y, widths);
    drawFooter(page, font, 'Blank latency is never reached, not zero. See barnes-trials.csv.');
  }

  // Events (first page)
  {
    const page = addPage(doc);
    let y = drawHeading(page, bold, 'Events', PAGE_H - MARGIN);
    const headers = ['animal', 'event', 'hole', 'start_s', 'end_s', 'source'];
    const widths = [80, 90, 44, 60, 60, 70];
    const rows: string[][] = [];
    for (const v of trials) {
      for (const e of v.events ?? []) {
        rows.push([
          v.animalId,
          e.kind,
          e.holeIndex === null ? '' : String(e.holeIndex),
          e.startT.toFixed(2),
          e.endT.toFixed(2),
          e.provenance,
        ]);
        if (rows.length >= 50) break;
      }
      if (rows.length >= 50) break;
    }
    y = drawTable(page, font, bold, headers, rows, y, widths);
    if ((trials.reduce((n, v) => n + (v.events?.length ?? 0), 0) ?? 0) > 50) {
      page.drawText('First 50 events. The full list is in barnes-events.csv.', {
        x: MARGIN,
        y: y - 8,
        size: 9,
        font,
        color: MUTED,
      });
    }
    drawFooter(page, font, 'Frame numbers in the CSV match the review timeline.');
  }

  // Cohort figures
  if (hasCohortSpan(project)) {
    const page = addPage(doc);
    let y = drawHeading(page, bold, 'Cohort', PAGE_H - MARGIN);
    const curve = learningCurveSvg(project, 'primaryLatencyS');
    const compare = cohortComparisonSvg(project, 'primaryLatencyS');
    const strat = strategyByDaySvg(project);
    const slot = 210;
    if (curve) y = await drawSvg(ctx, page, curve, MARGIN, y, PAGE_W - 2 * MARGIN, slot);
    if (compare) y = await drawSvg(ctx, page, compare, MARGIN, y, PAGE_W - 2 * MARGIN, slot);
    if (strat) await drawSvg(ctx, page, strat, MARGIN, y, PAGE_W - 2 * MARGIN, slot);
    drawFooter(page, font, 'Faint lines are animals; bold lines are cohort mean ± SEM.');
  }

  // Per trial
  for (const v of trials) {
    const page = addPage(doc);
    const s = v.summary!;
    let y = PAGE_H - MARGIN;
    page.drawText(`${s.animalId}  ·  ${v.fileName}`, { x: MARGIN, y, size: 14, font: bold, color: INK });
    y -= 16;
    const lat = s.primaryLatencyS === null ? 'never reached' : `${s.primaryLatencyS.toFixed(2)} s`;
    page.drawText(
      `Day ${s.day ?? '—'}  ${s.cohort}  ·  latency ${lat}  ·  errors ${s.primaryErrors}  ·  ${s.strategy.label}  ·  tracked ${(s.trackedFraction * 100).toFixed(0)}%${s.humanEditedFrames ? `  ·  ${s.humanEditedFrames} edited frames` : ''}${v.qcFlag ? `  ·  ${v.qcFlag}` : ''}`,
      { x: MARGIN, y, size: 8, font, color: MUTED },
    );
    y -= 18;

    const figW = (PAGE_W - 2 * MARGIN - 12) / 2;
    const figH = 220;
    if (v.track && v.map) {
      const left = timeColoredPathSvg(v.track, v.map, { size: 480 });
      const right = heatmapSvg(v.track, v.map, { size: 480 });
      const yLeft = await drawSvg(ctx, page, left, MARGIN, y, figW, figH);
      await drawSvg(ctx, page, right, MARGIN + figW + 12, y, figW, figH);
      y = yLeft;
      const raster = holeVisitRasterSvg(v.events ?? [], v.map, v.durationS, { width: 640 });
      await drawSvg(ctx, page, raster, MARGIN, y, PAGE_W - 2 * MARGIN, 200);
    }
    drawFooter(page, font, 'Time-colored path, occupancy heatmap, hole-visit raster.');
  }

  return doc.save();
}
