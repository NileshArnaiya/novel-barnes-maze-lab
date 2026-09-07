import type { Project, StrategyLabel, TrialSummary } from './types';

/**
 * Cohort-level aggregation for the learning curve.
 *
 * The unit of a Barnes maze experiment is the animal across days, not the
 * single trial, and the figure everyone draws is latency or errors falling over
 * training days. This turns the per-trial summaries into that curve: one point
 * per group per day, with a mean and the standard error that goes on the error
 * bar.
 *
 * SEM, not SD, because SEM is what behavioural figures put on their error bars,
 * and computing it by hand from SD and n is a step where mistakes happen.
 *
 * Censored trials, where the animal never reached the target, are counted and
 * excluded from the latency mean rather than folded in, because averaging a
 * timeout value biases the curve toward the animals that learned. The count is
 * returned so a caller can report it.
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
  // Group by cohort and day.
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

/** Distinct cohorts present, in a stable order, for colouring the curve. */
export function cohorts(project: Project): string[] {
  const set = new Set<string>();
  for (const v of project.videos) if (v.summary) set.add(v.summary.cohort);
  return [...set].sort();
}

/** Strategy counts per day, for a stacked strategy-over-training view. */
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
