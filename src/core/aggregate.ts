import type { Project, StrategyLabel, TrialSummary } from './types';

/**
 * One point per cohort per day for the learning curve.
 *
 * SEM on the error bars. Trials that never reached the target are counted
 * in nCensored and left out of the latency mean, not averaged in as a timeout.
 */

export interface CurvePoint {
  cohort: string;
  day: number;
  mean: number;
  sem: number;
  n: number;
  nCensored: number;
}

export type CurveMeasure =
  | 'primaryLatencyS'
  | 'totalLatencyS'
  | 'primaryErrors'
  | 'totalErrors'
  | 'pathLengthCm';

function value(s: TrialSummary, measure: CurveMeasure): number | null {
  const v = s[measure];
  return typeof v === 'number' ? v : null;
}

export function learningCurve(project: Project, measure: CurveMeasure): CurvePoint[] {
  const groups = new Map<string, TrialSummary[]>();
  for (const v of project.videos) {
    if (!v.summary || v.day === null) continue;
    const key = `${v.summary.cohort}||${v.day}`;
    const list = groups.get(key) ?? [];
    list.push(v.summary);
    groups.set(key, list);
  }

  const points: CurvePoint[] = [];
  for (const [key, trials] of groups) {
    const [cohort, dayStr] = key.split('||');
    const present = trials.map((t) => value(t, measure)).filter((x): x is number => x !== null);
    const nCensored = trials.length - present.length;

    if (present.length === 0) {
      points.push({ cohort: cohort!, day: Number(dayStr), mean: 0, sem: 0, n: 0, nCensored });
      continue;
    }

    const mean = present.reduce((a, b) => a + b, 0) / present.length;
    const variance =
      present.length > 1
        ? present.reduce((a, b) => a + (b - mean) ** 2, 0) / (present.length - 1)
        : 0;
    const sem = present.length > 1 ? Math.sqrt(variance) / Math.sqrt(present.length) : 0;

    points.push({ cohort: cohort!, day: Number(dayStr), mean, sem, n: present.length, nCensored });
  }

  return points.sort((a, b) => a.cohort.localeCompare(b.cohort) || a.day - b.day);
}

/** Cohort names, sorted, for colouring the curve. */
export function cohorts(project: Project): string[] {
  const set = new Set<string>();
  for (const v of project.videos) if (v.summary) set.add(v.summary.cohort);
  return [...set].sort();
}

/** Strategy counts per day for one cohort. */
export function strategyByDay(
  project: Project,
  cohort: string,
): { day: number; counts: Record<StrategyLabel, number> }[] {
  const byDay = new Map<number, Record<StrategyLabel, number>>();
  for (const v of project.videos) {
    if (!v.summary || v.summary.cohort !== cohort || v.day === null) continue;
    const rec =
      byDay.get(v.day) ?? { spatial: 0, serial: 0, random: 0, undetermined: 0 };
    rec[v.summary.strategy.label]++;
    byDay.set(v.day, rec);
  }
  return [...byDay.entries()]
    .map(([day, counts]) => ({ day, counts }))
    .sort((a, b) => a.day - b.day);
}

/** One animal, one day. Faint lines under the cohort mean. */
export interface AnimalDayPoint {
  animalId: string;
  cohort: string;
  day: number;
  value: number;
}

export function animalDayValues(project: Project, measure: CurveMeasure): AnimalDayPoint[] {
  const out: AnimalDayPoint[] = [];
  for (const v of project.videos) {
    if (!v.summary || v.day === null) continue;
    const val = value(v.summary, measure);
    if (val === null) continue;
    out.push({
      animalId: v.summary.animalId,
      cohort: v.summary.cohort,
      day: v.day,
      value: val,
    });
  }
  return out;
}

export const CURVE_MEASURES: { key: CurveMeasure; label: string; unit: string }[] = [
  { key: 'primaryLatencyS', label: 'Primary latency', unit: 's' },
  { key: 'totalLatencyS', label: 'Total latency', unit: 's' },
  { key: 'primaryErrors', label: 'Primary errors', unit: '' },
  { key: 'totalErrors', label: 'Total errors', unit: '' },
  { key: 'pathLengthCm', label: 'Path length', unit: 'cm' },
];

/** True if there are at least two days or two cohorts to plot. */
export function hasCohortSpan(project: Project): boolean {
  const days = new Set<number>();
  const groups = new Set<string>();
  for (const v of project.videos) {
    if (!v.summary) continue;
    groups.add(v.summary.cohort);
    if (v.day !== null) days.add(v.day);
  }
  return days.size >= 2 || groups.size >= 2;
}
