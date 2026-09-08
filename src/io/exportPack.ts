import { zipSync, strToU8 } from 'fflate';
import type { Project } from '../core/types';
import {
  eventsCsv,
  learningCurveCsv,
  parametersCsv,
  projectJson,
  strategyByDayCsv,
  trialSummaryCsv,
} from './csv';
import {
  cohortComparisonSvg,
  heatmapSvg,
  holeVisitRasterSvg,
  learningCurveSvg,
  strategyByDaySvg,
  timeColoredPathSvg,
  trajectorySvg,
} from './figures';
import { browserRasterizer, buildReportPdf } from './report';
import { methodsText } from './workbook';

/**
 * ZIP of tidy CSVs, SVG figures, and the compiled PDF.
 */

export interface PackFile {
  path: string;
  bytes: Uint8Array;
}

function utf8(s: string): Uint8Array {
  return strToU8(s);
}

function nonemptyCsv(csv: string): boolean {
  return csv.trim().split('\n').length > 1;
}

export function packFiles(project: Project, pdf?: Uint8Array): PackFile[] {
  const files: PackFile[] = [
    { path: 'barnes-trials.csv', bytes: utf8(trialSummaryCsv(project)) },
    { path: 'barnes-events.csv', bytes: utf8(eventsCsv(project)) },
    { path: 'barnes-parameters.csv', bytes: utf8(parametersCsv(project)) },
    { path: 'barnes-project.json', bytes: utf8(projectJson(project)) },
    { path: 'methods.txt', bytes: utf8(methodsText(project)) },
  ];

  const lc = learningCurveCsv(project);
  if (nonemptyCsv(lc)) files.push({ path: 'barnes-learning-curve.csv', bytes: utf8(lc) });
  const stratCsv = strategyByDayCsv(project);
  if (nonemptyCsv(stratCsv)) files.push({ path: 'barnes-strategy-by-day.csv', bytes: utf8(stratCsv) });

  const curve = learningCurveSvg(project, 'primaryLatencyS');
  if (curve) files.push({ path: 'figures/learning-curve.svg', bytes: utf8(curve) });
  const compare = cohortComparisonSvg(project, 'primaryLatencyS');
  if (compare) files.push({ path: 'figures/cohort-comparison.svg', bytes: utf8(compare) });
  const strat = strategyByDaySvg(project);
  if (strat) files.push({ path: 'figures/strategy-by-day.svg', bytes: utf8(strat) });

  for (const v of project.videos) {
    if (!v.track || !v.map || !v.summary) continue;
    const stem = `${v.animalId}-${v.day ?? 'na'}-${v.id}`.replace(/[^\w.-]+/g, '_');
    files.push({
      path: `figures/${stem}-trajectory.svg`,
      bytes: utf8(trajectorySvg(v.track, v.map)),
    });
    files.push({
      path: `figures/${stem}-time-path.svg`,
      bytes: utf8(timeColoredPathSvg(v.track, v.map)),
    });
    files.push({
      path: `figures/${stem}-heatmap.svg`,
      bytes: utf8(heatmapSvg(v.track, v.map)),
    });
    files.push({
      path: `figures/${stem}-hole-raster.svg`,
      bytes: utf8(holeVisitRasterSvg(v.events ?? [], v.map, v.durationS)),
    });
  }

  if (pdf) files.push({ path: 'barnes-report.pdf', bytes: pdf });
  return files;
}

export function zipPack(files: readonly PackFile[]): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  for (const f of files) tree[f.path] = f.bytes;
  return zipSync(tree);
}

export async function buildCombinedZip(project: Project): Promise<Uint8Array> {
  const pdf = await buildReportPdf(project, browserRasterizer);
  return zipPack(packFiles(project, pdf));
}

export function downloadBytes(filename: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
