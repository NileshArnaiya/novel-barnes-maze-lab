import { cohorts, learningCurve, type CurveMeasure } from '../../core/aggregate';
import type { Project } from '../../core/types';

/**
 * The learning curve, drawn as an inline SVG.
 *
 * The figure every Barnes maze paper contains: a measure falling across
 * training days as the animals learn. One line per cohort, points at the mean,
 * whiskers at the standard error. Kept as hand-drawn SVG rather than a chart
 * library so it has no dependency and so the same code can be exported as a
 * publication figure later.
 *
 * Needs at least two days to be a curve; with one day it says so rather than
 * drawing a single point and calling it a trend.
 */

const COHORT_COLORS = ['#c05f3c', '#1d7d62', '#b0741a', '#4a5c8a', '#8a4a6f'];

const MEASURES: { key: CurveMeasure; label: string; unit: string }[] = [
  { key: 'primaryLatencyS', label: 'Primary latency', unit: 's' },
  { key: 'totalLatencyS', label: 'Total latency', unit: 's' },
  { key: 'primaryErrors', label: 'Primary errors', unit: '' },
  { key: 'totalErrors', label: 'Total errors', unit: '' },
  { key: 'pathLengthCm', label: 'Path length', unit: 'cm' },
];

export function LearningCurve({
  project,
  measure,
  onMeasure,
}: {
  project: Project;
  measure: CurveMeasure;
  onMeasure: (m: CurveMeasure) => void;
}) {
  const points = learningCurve(project, measure);
  const groups = cohorts(project);
  const days = [...new Set(points.map((p) => p.day))].sort((a, b) => a - b);
  const spec = MEASURES.find((m) => m.key === measure)!;

  if (days.length < 2) {
    return (
      <div>
        <p className="hint">
          A learning curve needs at least two training days. These trials span{' '}
          {days.length === 0 ? 'no labelled days' : 'a single day'}, so there is no curve to draw
          yet. Set the day on each trial in step 1, or load more days.
        </p>
      </div>
    );
  }

  const W = 620;
  const H = 340;
  const padL = 54;
  const padR = 130; // room for the legend
  const padB = 44;
  const padT = 20;

  const maxVal = Math.max(...points.map((p) => p.mean + p.sem), 1);
  const minDay = days[0]!;
  const maxDay = days[days.length - 1]!;

  const x = (day: number) =>
    padL + ((day - minDay) / (maxDay - minDay || 1)) * (W - padL - padR);
  const y = (val: number) => H - padB - (val / maxVal) * (H - padT - padB);

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <label htmlFor="curve-measure">Measure</label>
        <select
          id="curve-measure"
          value={measure}
          onChange={(e) => onMeasure(e.target.value as CurveMeasure)}
        >
          {MEASURES.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${spec.label} across training days, one line per cohort`}>
        {/* Axes */}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#cfc5b7" strokeWidth="1" />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#cfc5b7" strokeWidth="1" />

        {/* Y ticks */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <text x={padL - 8} y={y(maxVal * f) + 4} textAnchor="end" fontSize="11" fill="#5f574f">
              {(maxVal * f).toFixed(maxVal < 10 ? 1 : 0)}
            </text>
            <line x1={padL} y1={y(maxVal * f)} x2={W - padR} y2={y(maxVal * f)} stroke="#efe9df" strokeWidth="1" />
          </g>
        ))}
        <text
          x={16}
          y={H / 2}
          fontSize="12"
          fill="#26221f"
          transform={`rotate(-90 16 ${H / 2})`}
          textAnchor="middle"
        >
          {spec.label}{spec.unit ? ` (${spec.unit})` : ''}
        </text>

        {/* X ticks */}
        {days.map((d) => (
          <text key={d} x={x(d)} y={H - padB + 18} textAnchor="middle" fontSize="11" fill="#5f574f">
            {d}
          </text>
        ))}
        <text x={(padL + W - padR) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="#26221f">
          Training day
        </text>

        {/* One line per cohort */}
        {groups.map((cohort, ci) => {
          const color = COHORT_COLORS[ci % COHORT_COLORS.length]!;
          const cp = points.filter((p) => p.cohort === cohort && p.n > 0);
          if (cp.length === 0) return null;
          const d = cp.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)} ${y(p.mean).toFixed(1)}`).join(' ');
          return (
            <g key={cohort}>
              <path d={d} fill="none" stroke={color} strokeWidth="2" />
              {cp.map((p) => (
                <g key={p.day}>
                  {/* Error bar */}
                  <line x1={x(p.day)} y1={y(p.mean - p.sem)} x2={x(p.day)} y2={y(p.mean + p.sem)} stroke={color} strokeWidth="1.5" />
                  <line x1={x(p.day) - 4} y1={y(p.mean + p.sem)} x2={x(p.day) + 4} y2={y(p.mean + p.sem)} stroke={color} strokeWidth="1.5" />
                  <line x1={x(p.day) - 4} y1={y(p.mean - p.sem)} x2={x(p.day) + 4} y2={y(p.mean - p.sem)} stroke={color} strokeWidth="1.5" />
                  <circle cx={x(p.day)} cy={y(p.mean)} r="4" fill={color} />
                </g>
              ))}
              {/* Legend entry, with a shape as well as colour */}
              <g>
                <circle cx={W - padR + 16} cy={padT + 6 + ci * 20} r="4" fill={color} />
                <text x={W - padR + 26} y={padT + 10 + ci * 20} fontSize="12" fill="#26221f">
                  {cohort}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      <p className="hint" style={{ marginTop: 8 }}>
        Points are group means, whiskers are the standard error. Trials where the animal never
        reached the target are excluded from the latency mean rather than averaged in as the
        timeout; the count of excluded trials is in the workbook summary sheet.
      </p>
    </div>
  );
}
