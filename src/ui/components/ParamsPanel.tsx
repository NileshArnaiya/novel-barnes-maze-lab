import { PARAM_SPECS } from '../../core/params';
import type { ScoringParams } from '../../core/types';

/**
 * The parameter panel.
 *
 * Every threshold that affects a number is here, visible, with an explanation
 * of what moving it does. This is not a settings screen tucked behind a gear
 * icon: it sits beside the measures, because the relationship between the two
 * is the thing a user most needs to understand.
 *
 * Changing a value rescores everything immediately. Watching an error count
 * move as you drag the radius is a faster and more honest way to understand a
 * threshold than any amount of documentation.
 */
export function ParamsPanel({
  params,
  onChange,
}: {
  params: ScoringParams;
  onChange: (p: ScoringParams) => void;
}) {
  return (
    <div>
      <h3>Scoring thresholds</h3>
      <p className="hint" style={{ marginTop: 4, marginBottom: 16 }}>
        These define every number on this page. They are written into every export so a
        result can be reproduced later.
      </p>
      {PARAM_SPECS.map((spec) => (
        <div className="param" key={spec.key}>
          <div className="head">
            <label htmlFor={spec.key}>{spec.label}</label>
            <span className="val">
              {params[spec.key]} {spec.unit}
            </span>
          </div>
          <input
            id={spec.key}
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={params[spec.key]}
            onChange={(e) => onChange({ ...params, [spec.key]: Number(e.target.value) })}
          />
          <p className="help">{spec.help}</p>
        </div>
      ))}
    </div>
  );
}
