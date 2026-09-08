import { useEffect, useMemo, useState } from 'react';
import { assessQuality } from '../../core/quality';
import {
  buildPayload,
  DEFAULT_OLLAMA_URL,
  explainTrial,
  listOllamaModels,
  loadOllamaSettings,
  saveOllamaSettings,
  type ChatTurn,
  type OllamaSettings,
} from '../../io/explain';
import { useStore } from '../../state/store';

/**
 * Local chat about the numbers already on the page.
 *
 * Opens only from the button above the accessibility control. No request fires
 * on load, on selecting a trial, or on scoring. The payload is inspectable
 * before anything is sent, because a privacy claim the user cannot verify is
 * worth very little.
 *
 * Ollama is a stand-in. The intended end state is a small local model that
 * reads this same payload.
 */

const SUGGESTED = [
  'How many seconds was the animal not visible?',
  'How long was it in the target quadrant?',
  'How much time was spent hugging the platform edge?',
  'What search strategy did this trial use, and why?',
  'How long until it first reached the target?',
  'How many wrong holes before the target?',
  'Is tracking good enough to trust these numbers?',
  'Did it escape, or is this a probe trial?',
];

export function TrialChatButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        className="chat-fab"
        onClick={() => setOpen(true)}
        aria-label="Ask about this trial"
        aria-haspopup="dialog"
        title="Ask about this trial"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8.8L4 21.2V5a2 2 0 0 1 2-2z"
          />
        </svg>
      </button>
      {open ? <TrialChatDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TrialChatDialog({ onClose }: { onClose: () => void }) {
  const { activeVideo, project } = useStore();
  const [settings, setSettings] = useState<OllamaSettings>(() => loadOllamaSettings());
  const [showSettings, setShowSettings] = useState(() => !loadOllamaSettings().model);
  const [showPayload, setShowPayload] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const quality = useMemo(() => {
    if (!activeVideo?.track) return null;
    return assessQuality(activeVideo.track, activeVideo.fps);
  }, [activeVideo]);

  const scored =
    Boolean(activeVideo?.summary && activeVideo.map && quality);

  const payload = useMemo(() => {
    if (!activeVideo?.summary || !activeVideo.map || !quality) return null;
    return buildPayload({
      summary: activeVideo.summary,
      quality,
      params: project.params,
      trialType: activeVideo.trialType,
      holeCount: activeVideo.map.holes.length,
      durationS: activeVideo.durationS,
    });
  }, [activeVideo, project.params, quality]);

  const refreshModels = async (baseUrl: string) => {
    setListing(true);
    setModelsError(null);
    const result = await listOllamaModels(baseUrl);
    if (result.ok) {
      setModels(result.models);
      if (result.models.length === 0) {
        setModelsError('Ollama is running but has no models. Pull one, then refresh this list.');
      }
    } else {
      setModels([]);
      setModelsError(result.error);
    }
    setListing(false);
  };

  useEffect(() => {
    if (showSettings) void refreshModels(settings.baseUrl);
  }, [showSettings]);

  const persistSettings = (next: OllamaSettings) => {
    saveOllamaSettings(next);
    setSettings(next);
  };

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (!scored || !activeVideo?.summary || !activeVideo.map || !quality) {
      setError('Score a trial in Review first. The chat only sees numbers already on the page, never the video.');
      return;
    }
    if (!settings.model) {
      setShowSettings(true);
      setError('No Ollama model is selected. Start Ollama, then pick a model.');
      return;
    }

    setBusy(true);
    setError(null);
    setQuestion('');
    const history = turns;
    setTurns((prev) => [...prev, { role: 'user', text: trimmed }]);

    const result = await explainTrial({
      summary: activeVideo.summary,
      quality,
      params: project.params,
      trialType: activeVideo.trialType,
      holeCount: activeVideo.map.holes.length,
      durationS: activeVideo.durationS,
      question: trimmed,
      history,
    });

    if (result.ok) {
      setTurns((prev) => [...prev, { role: 'assistant', text: result.text }]);
    } else {
      setTurns((prev) => prev.slice(0, -1));
      setQuestion(trimmed);
      setError(result.error);
    }
    setBusy(false);
  };

  const started = turns.length > 0;

  return (
    <div
      className="walkthrough-backdrop chat-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Ask about this trial"
      onClick={onClose}
    >
      <div className="chat-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="chat-header">
          <div>
            <h2>Ask about this trial</h2>
            <p className="hint">
              Assistant for scored Barnes maze numbers. Scoring never depends on it. Ollama is
              the stand-in until a small local model can read this same payload.
            </p>
          </div>
          <div className="chat-header-actions">
            <button
              className="ghost chat-icon-btn"
              onClick={() => setShowSettings((v) => !v)}
              aria-expanded={showSettings}
              aria-label="Ollama settings"
              title="Ollama settings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M19.14 12.94a7.5 7.5 0 0 0 .05-.94 7.5 7.5 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94L14.5 2.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.5l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.6 8.56a.5.5 0 0 0 .12.64l2.03 1.58a7.5 7.5 0 0 0-.05.94c0 .32.02.63.05.94L2.72 14.24a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
                />
              </svg>
            </button>
            <button className="ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        {showSettings ? (
          <div className="chat-settings">
            <label className="stack">
              <span className="hint">Ollama URL</span>
              <input
                type="text"
                value={settings.baseUrl}
                onChange={(e) => persistSettings({ ...settings, baseUrl: e.target.value })}
                aria-label="Ollama URL"
              />
            </label>
            <label className="stack">
              <span className="hint">Model</span>
              <select
                value={settings.model}
                onChange={(e) => persistSettings({ ...settings, model: e.target.value })}
                aria-label="Ollama model"
              >
                <option value="">Select a model</option>
                {settings.model && !models.includes(settings.model) ? (
                  <option value={settings.model}>{settings.model}</option>
                ) : null}
                {models.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => void refreshModels(settings.baseUrl || DEFAULT_OLLAMA_URL)}
              disabled={listing}
            >
              {listing ? 'Looking' : 'Refresh models'}
            </button>
            {modelsError ? <div className="notice">{modelsError}</div> : null}
            <button
              className="ghost"
              style={{ fontSize: 13, padding: '4px 0' }}
              onClick={() => setShowPayload(!showPayload)}
              aria-expanded={showPayload}
            >
              {showPayload ? 'Hide' : 'Show'} exactly what gets sent
            </button>
            {showPayload ? (
              <pre className="chat-payload">
                {payload
                  ? JSON.stringify(payload, null, 2)
                  : 'Nothing is sent until a trial is scored.'}
              </pre>
            ) : null}
          </div>
        ) : null}

        <div className="chat-body">
          {!scored ? (
            <p className="hint">
              Score a trial in Review first. The chat only sees numbers already on the page,
              never the video.
            </p>
          ) : null}

          {!started ? (
            <div>
              <h3 className="chat-prompts-title">Suggested prompts</h3>
              <div className="chat-prompts">
                {SUGGESTED.map((prompt) => (
                  <button
                    key={prompt}
                    className="chat-prompt"
                    disabled={busy || !scored}
                    onClick={() => void ask(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {started ? (
            <div className="chat-thread" aria-live="polite">
              {turns.map((turn, i) => (
                <div key={`${turn.role}-${i}`} className={`chat-turn ${turn.role}`}>
                  {turn.text.split('\n').map((line, n) => (
                    <p key={n} style={{ margin: n === 0 ? 0 : '8px 0 0' }}>
                      {line}
                    </p>
                  ))}
                </div>
              ))}
              {busy ? <p className="hint">Asking the local model.</p> : null}
            </div>
          ) : null}

          {error ? <div className="notice">{error}</div> : null}
        </div>

        <form
          className="chat-input-bar"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <input
            type="text"
            className="grow"
            placeholder="Type your message here... (Enter to send)"
            aria-label="Question about this trial"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={busy}
          />
          <button
            className="primary chat-send"
            type="submit"
            disabled={busy || !question.trim()}
            aria-label="Send"
          >
            {busy ? '…' : '→'}
          </button>
        </form>
      </div>
    </div>
  );
}
