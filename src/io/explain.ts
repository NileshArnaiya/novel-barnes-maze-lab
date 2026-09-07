import type { QualityReport } from '../core/quality';
import type { ScoringParams, TrialSummary, VideoRecord } from '../core/types';

/**
 * Optional plain-language explanation of a scored trial.
 *
 * This is the one feature in the tool that can send anything off the machine,
 * so the design is deliberately restrictive and the restrictions are the point.
 *
 * What is sent: a short list of numbers already computed, plus the thresholds
 * that produced them. Latency, error counts, path length, tracked fraction,
 * strategy label. That is all.
 *
 * What is never sent, under any configuration: video frames, images, raw
 * trajectories, coordinates, filenames, animal identifiers, or anything that
 * could reconstruct the recording. There is no code path that puts a frame in a
 * request, because a hosted model that can see the footage is exactly the thing
 * the rest of this tool exists to avoid. Video of animal work sits under an
 * IACUC protocol at most institutions, and "we only sent a few frames" is not a
 * conversation anyone wants to have with their compliance office.
 *
 * The feature is off unless a key is configured, and it is additive: it explains
 * numbers the tool already computed and displayed. Nothing depends on it, no
 * measure changes, and the tool is complete without it. A lab that cannot send
 * anything anywhere loses a paragraph of prose and nothing else.
 */

export interface ExplainRequest {
  summary: TrialSummary;
  quality: QualityReport;
  params: ScoringParams;
  trialType: VideoRecord['trialType'];
  holeCount: number;
  /** What the user asked, if anything. */
  question?: string;
}

export type ExplainResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Is the explainer available?
 *
 * The key comes from a build-time environment variable. It is embedded in the
 * bundle, which means it is visible to anyone who opens the deployed page. That
 * is a real property of any client-side app and it is stated in the README:
 * use a key restricted to this feature, with a spending cap, and rotate it if
 * the deployment is public. There is no way to hide a key in a static site, and
 * pretending otherwise would be worse than saying so.
 */
export function explainerAvailable(): boolean {
  return Boolean(import.meta.env.VITE_GEMINI_API_KEY);
}

/**
 * Build the payload. Extracted so it can be tested and, more importantly, so
 * anyone reviewing this file can see the complete set of what leaves the
 * machine in one place rather than inferring it from string interpolation.
 */
export function buildPayload(req: ExplainRequest): Record<string, unknown> {
  const s = req.summary;
  return {
    trial_type: req.trialType,
    hole_count: req.holeCount,
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
- On a probe trial there is no escape box, so total latency is undefined rather than zero.
- One trial is one observation from one animal. Never draw a conclusion about learning, a group, or a treatment from a single trial.
- Path length skips stretches where the animal was not visible rather than interpolating, so it under-reports rather than inventing distance.

Do not invent numbers you were not given. Do not suggest statistical tests for a single trial. If the numbers look internally inconsistent, say which two disagree and what would cause it. End with the single most useful thing to check next.`;

/**
 * Ask Gemini to explain the trial.
 *
 * Errors are returned rather than thrown, and the caller shows them inline. A
 * failed explanation must never interrupt scoring, because scoring is the
 * product and this is a convenience on top of it.
 */
export async function explainTrial(req: ExplainRequest): Promise<ExplainResult> {
  const key = import.meta.env.VITE_GEMINI_API_KEY;
  if (!key) {
    return { ok: false, error: 'No API key is configured, so the explainer is switched off.' };
  }

  const payload = buildPayload(req);
  const question = req.question?.trim();

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: question
                    ? `Trial data:\n${JSON.stringify(payload, null, 2)}\n\nThe student asks: ${question}`
                    : `Trial data:\n${JSON.stringify(payload, null, 2)}\n\nExplain what this trial shows.`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.3, maxOutputTokens: 400 },
        }),
      },
    );

    if (!response.ok) {
      // Name the likely cause rather than showing a bare status code. A quota
      // error and a bad key need different actions from the user.
      const hint =
        response.status === 429
          ? 'The API quota is exhausted. This is a rate limit, not a problem with your data.'
          : response.status === 400 || response.status === 403
            ? 'The API key was rejected. Check it is valid and that the Generative Language API is enabled for it.'
            : `The API returned ${response.status}.`;
      return { ok: false, error: hint };
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

    if (!text.trim()) {
      return { ok: false, error: 'The model returned an empty response. Try again.' };
    }
    return { ok: true, text };
  } catch {
    return {
      ok: false,
      error: 'Could not reach the API. Check your network connection, or carry on without it.',
    };
  }
}
