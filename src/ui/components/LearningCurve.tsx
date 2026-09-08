import { CURVE_MEASURES, type CurveMeasure } from '../../core/aggregate';
import { downloadPng, downloadSvg, learningCurveSvg } from '../../io/figures';
import type { Project } from '../../core/types';

/** Learning curve. Same SVG as the download and the PDF. */

export function LearningCurve({
  project,
  measure,
  onMeasure,
}: {
  project: Project;
  measure: CurveMeasure;
  onMeasure: (m: CurveMeasure) => void;
}) {
  const svg = learningCurveSvg(project, measure);
  const spec = CURVE_MEASURES.find((m) => m.key === measure)!;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <label htmlFor="curve-measure">Measure</label>
        <select
          id="curve-measure"
          value={measure}
          onChange={(e) => onMeasure(e.target.value as CurveMeasure)}
        >
          {CURVE_MEASURES.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        {svg ? (
          <>
            <span className="grow" />
            <button onClick={() => downloadSvg(`learning-curve-${measure}.svg`, svg)}>
              Download SVG
            </button>
            <button onClick={() => void downloadPng(`learning-curve-${measure}.png`, svg)}>
              Download PNG
            </button>
          </>
        ) : null}
      </div>

      {svg ? (
        <div
          style={{ border: '1px solid var(--rule)', borderRadius: 8, overflow: 'hidden' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <p className="hint">
          A learning curve needs at least two training days. Set the day on each trial in step 1,
          or load more days.
        </p>
      )}

      {svg ? (
        <p className="hint" style={{ marginTop: 8 }}>
          {spec.label} across training days, one line per cohort. Points are group means, whiskers
          are the standard error. Trials where the animal never reached the target are excluded
          from the latency mean rather than averaged in as the timeout.
        </p>
      ) : null}
    </div>
  );
}
