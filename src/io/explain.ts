import type { QualityReport } from '../core/quality';
import type { ScoringParams, TrialSummary, VideoRecord } from '../core/types';

/**
 * Optional plain-language chat about a scored trial.
 *
 * This is the one feature that makes a network request, and the request goes to
 * Ollama on the researcher's machine, not to a hosted model. A later local
 * foundational model can reuse this payload and this UI.
 *
 * What is sent: a short list of numbers already computed, plus the thresholds
 * that produced them. Latency, error counts, path length, tracked fraction,
 * strategy label, duration, and time the animal was not visible. That is all.
 *
 * What is never sent, under any configuration: video frames, images, raw
 * trajectories, coordinates, filenames, animal identifiers, or anything that
 * could reconstruct the recording. There is no code path that puts a frame in a
 * request. Video of animal work sits under an IACUC protocol at most
 * institutions, and "we only sent a few frames" is not a conversation anyone
 * wants to have with their compliance office.
 *
 * The feature is off until the user opens the chat and asks. Nothing depends on
 * it, no measure changes, and the tool is complete without it.
 */

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

const SETTINGS_KEY = 'barnes-maze-ollama';

export interface OllamaSettings {
  baseUrl: string;
  model: string;
}

export interface ExplainRequest {
  summary: TrialSummary;
  quality: QualityReport;
  params: ScoringParams;
  trialType: VideoRecord['trialType'];
  holeCount: number;
  durationS: number;
  /** What the user asked, if anything. */
  question?: string;
  /** Earlier turns in this thread, questions as the user typed them. */
  history?: ChatTurn[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export type ExplainResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export type ModelListResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

export function loadOllamaSettings(): OllamaSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { baseUrl: DEFAULT_OLLAMA_URL, model: '' };
    const parsed = JSON.parse(raw) as Partial<OllamaSettings>;
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim()
        ? parsed.baseUrl.trim().replace(/\/$/, '')
        : DEFAULT_OLLAMA_URL,
      model: typeof parsed.model === 'string' ? parsed.model.trim() : '',
    };
  } catch {
    return { baseUrl: DEFAULT_OLLAMA_URL, model: '' };
  }
}

export function saveOllamaSettings(settings: OllamaSettings): void {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      baseUrl: settings.baseUrl.trim().replace(/\/$/, '') || DEFAULT_OLLAMA_URL,
      model: settings.model.trim(),
    }),
  );
}

/** True once the user has picked a local model. Scoring does not wait on this. */
export function explainerAvailable(): boolean {
  return Boolean(loadOllamaSettings().model);
}

/**
 * Build the payload. Extracted so it can be tested and, more importantly, so
 * anyone reviewing this file can see the complete set of what leaves the
 * scoring core in one place rather than inferring it from string interpolation.
 */
export function buildPayload(req: ExplainRequest): Record<string, unknown> {
  const s = req.summary;
  const notVisibleS = req.durationS * (1 - s.trackedFraction);
  return {
    trial_type: req.trialType,
    hole_count: req.holeCount,
    duration_s: Number(req.durationS.toFixed(1)),
    not_visible_s: Number(notVisibleS.toFixed(1)),
    reached_target: s.primaryLatencyS !== null,
    primary_latency_s: s.primaryLatencyS,
    escaped: s.totalLatencyS !== null,
    total_latency_s: s.totalLatencyS,
    primary_errors: s.primaryErrors,
    total_errors: s.totalErrors,
    path_length_cm: Number(s.pathLengthCm.toFixed(1)),
    mean_speed_cm_s: Number(s.meanSpeedCmS.toFixed(1)),
    target_quadrant_time_s: Number(s.targetQuadrantTimeS.toFixed(1)),
    strategy: s.strategy.label,
    strategy_confidence: s.strategy.confidence,
    strategy_reasoning: s.strategy.reasoning,
    path_directness: Number(s.strategy.features.pathDirectness.toFixed(2)),
    longest_serial_run: s.strategy.features.longestSerialRun,
    thigmotaxis_fraction: Number(s.strategy.features.thigmotaxisFraction.toFixed(2)),
    tracked_fraction: Number(s.trackedFraction.toFixed(3)),
    longest_gap_s: Number(req.quality.longestGapS.toFixed(1)),
    gap_count: req.quality.gaps.length,
    human_edited_frames: s.humanEditedFrames,
    thresholds: req.params,
  };
}

const SYSTEM = `You are helping a graduate student interpret one Barnes maze trial that has already been scored by a local tool. You are given only summary numbers. You cannot see the video, the trajectory, or the animal.

Explain what these numbers mean for this trial in plain language, in under 150 words. Be specific to the values given.

Domain rules you must respect:
- A serial searcher works around the ring hole by hole. That produces a short latency and a high error count from a strategy that needs no spatial memory, so never read a short latency alone as good learning.
- Thigmotaxis, hugging the platform edge, is an anxiety readout that mimics poor memory in latency and error counts. Flag it above about 0.5.
- A low tracked fraction means the other numbers are computed from partial data and under-report. Say so plainly when it is below 0.9.
- not_visible_s is time in lost frames. Frames where the animal was in a hole are not lost, so do not treat in-hole time as not visible.
- On a probe trial there is no escape box, so total latency is undefined rather than zero.
- One trial is one observation from one animal. Never draw a conclusion about learning, a group, or a treatment from a single trial.
- Path length skips stretches where the animal was not visible rather than interpolating, so it under-reports rather than inventing distance.

Do not invent numbers you were not given. Do not suggest statistical tests for a single trial. If the numbers look internally inconsistent, say which two disagree and what would cause it. End with the single most useful thing to check next.`;

function ollamaUnreachable(baseUrl: string): string {
  return `Could not reach Ollama at ${baseUrl}. Start Ollama, then allow this page with OLLAMA_ORIGINS, and pick a model.`;
}

export async function listOllamaModels(baseUrl: string): Promise<ModelListResult> {
  const root = (baseUrl.trim() || DEFAULT_OLLAMA_URL).replace(/\/$/, '');
  try {
    const response = await fetch(`${root}/api/tags`);
    if (!response.ok) {
      return {
        ok: false,
        error:
          response.status === 403
            ? `Ollama refused this page. Set OLLAMA_ORIGINS to include this origin, then try again.`
            : `Ollama returned ${response.status} from ${root}. Check the URL.`,
      };
    }
    const data = (await response.json()) as { models?: { name?: string }[] };
    const models = (data.models ?? [])
      .map((m) => m.name?.trim() ?? '')
      .filter(Boolean);
    return { ok: true, models };
  } catch {
    return { ok: false, error: ollamaUnreachable(root) };
  }
}

/**
 * Ask the local Ollama model to explain the trial.
 *
 * Errors are returned rather than thrown, and the caller shows them inline. A
 * failed explanation must never interrupt scoring, because scoring is the
 * product and this is a convenience on top of it.
 */
export async function explainTrial(req: ExplainRequest): Promise<ExplainResult> {
  const settings = loadOllamaSettings();
  if (!settings.model) {
    return {
      ok: false,
      error: 'No Ollama model is selected. Open settings, start Ollama, and pick a model.',
    };
  }

  const payload = buildPayload(req);
  const question = req.question?.trim() || 'Explain what this trial shows.';
  const history = req.history ?? [];

  try {
    const response = await fetch(`${settings.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.model,
        stream: false,
        messages: [
          {
            role: 'system',
            content: `${SYSTEM}\n\nTrial data:\n${JSON.stringify(payload, null, 2)}`,
          },
          ...history.map((turn) => ({ role: turn.role, content: turn.text })),
          { role: 'user', content: question },
        ],
        options: { temperature: 0.3, num_predict: 400 },
      }),
    });

    if (!response.ok) {
      const hint =
        response.status === 403
          ? `Ollama refused this page. Set OLLAMA_ORIGINS to include this origin, then try again.`
          : response.status === 404
            ? `Model "${settings.model}" was not found. Pull it in Ollama, or pick another model.`
            : `Ollama returned ${response.status} from ${settings.baseUrl}.`;
      return { ok: false, error: hint };
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      error?: string;
    };
    if (data.error) {
      return { ok: false, error: data.error };
    }
    const text = data.message?.content ?? '';

    if (!text.trim()) {
      return { ok: false, error: 'The model returned an empty response. Try again.' };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, error: ollamaUnreachable(settings.baseUrl) };
  }
}
