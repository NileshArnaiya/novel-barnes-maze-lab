import { useState } from 'react';
import type { QualityReport } from '../../core/quality';
import type { ScoringParams, VideoRecord } from '../../core/types';
import { buildPayload, explainerAvailable, explainTrial } from '../../io/explain';

/**
 * Plain-language explanation of a scored trial, on request.
 *
 * Two design decisions worth stating.
 *
 * It is off until asked. No request fires on page load, on selecting a trial,
 * or on scoring. A user who never presses the button never sends anything, and
 * that has to be true by construction rather than by configuration.
 *
 * It shows exactly what will be sent, before sending it. A privacy claim the
 * user cannot verify is worth very little, so the payload is inspectable in the
 * interface rather than described in a README they will not read.
 */
export function Explainer({
  video,
  quality,
  params,
}: {
  video: VideoRecord;
  quality: QualityReport;
  params: ScoringParams;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [showPayload, setShowPayload] = useState(false);

  if (!video.summary || !video.map) return null;

  const payload = buildPayload({
    summary: video.summary,
    quality,
    params,
    trialType: video.trialType,
    holeCount: video.map.holes.length,
  });

  if (!explainerAvailable()) {
    return (
      <div className="panel">
        <h3>Explain this trial</h3>
        <p className="hint" style={{ marginTop: 6 }}>
          An optional feature that puts these numbers into a paragraph of plain language. It is
          switched off because no API key is configured. Everything else in the tool works
          without it, and nothing leaves your machine while it is off. To switch it on, set{' '}
          <code>VITE_GEMINI_API_KEY</code> in a <code>.env</code> file and rebuild. See the
          README for what is sent and what never is.
        </p>
      </div>
    );
  }

  const ask = async () => {
    setBusy(true);
    setError(null);
    const result = await explainTrial({
      summary: video.summary!,
      quality,
      params,
      trialType: video.trialType,
      holeCount: video.map!.holes.length,
      question: question || undefined,
    });
    if (result.ok) setText(result.text);
    else setError(result.error);
    setBusy(false);
  };

  return (
    <div className="panel">
      <h3>Explain this trial</h3>
      <p className="hint" style={{ marginTop: 6, marginBottom: 12 }}>
        Sends the numbers on this page to Google Gemini and asks for a plain-language reading of
        them. No frames, no trajectory, no filenames, and no animal identifiers are sent, and
        nothing is sent until you press the button.
      </p>

      <div className="row" style={{ marginBottom: 10 }}>
        <input
          type="text"
          className="grow"
          placeholder="Ask something specific, or leave blank"
          aria-label="Question about this trial"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void ask();
          }}
        />
        <button onClick={() => void ask()} disabled={busy}>
          {busy ? 'Asking' : 'Explain'}
        </button>
      </div>

      <button
        className="ghost"
        style={{ fontSize: 13, padding: '4px 0' }}
        onClick={() => setShowPayload(!showPayload)}
        aria-expanded={showPayload}
      >
        {showPayload ? 'Hide' : 'Show'} exactly what gets sent
      </button>

      {showPayload ? (
        <pre
          style={{
            background: 'var(--paper-sunk)',
            padding: 12,
            borderRadius: 8,
            fontSize: 11,
            overflowX: 'auto',
            maxHeight: 240,
          }}
        >
          {JSON.stringify(payload, null, 2)}
        </pre>
      ) : null}

      {error ? (
        <div className="notice" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}

      {text ? (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            background: 'var(--paper-sunk)',
            borderRadius: 8,
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {text.split('\n').map((line, i) => (
            <p key={i} style={{ margin: i === 0 ? 0 : '10px 0 0' }}>
              {line}
            </p>
          ))}
          <p className="hint" style={{ marginTop: 12, fontSize: 12 }}>
            Written by a language model from the numbers above. It cannot see your video. Check it
            against the trial before quoting it anywhere.
          </p>
        </div>
      ) : null}
    </div>
  );
}
