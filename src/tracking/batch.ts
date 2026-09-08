import type { MazeMap, ScoringParams } from '../core/types';
import { trackVideo, type TrackingOptions, type TrackingResult } from './runTracker';

/**
 * Track a list of videos one at a time.
 *
 * Sequential on purpose: the browser decoder is shared. One bad file is
 * recorded and the rest keep going. Each success is saved before the next starts.
 */

export interface BatchItem {
  videoId: string;
  fileName: string;
  file: File;
  map: MazeMap;
}

export interface BatchProgress {
  /** 1-based, for "video 3 of 12". */
  index: number;
  total: number;
  fileName: string;
  /** Fraction of the current video, 0..1. */
  fraction: number;
  message: string;
}

export interface BatchOutcome {
  videoId: string;
  fileName: string;
  ok: boolean;
  /** What happened for this file. */
  note: string;
}

export interface BatchHandlers {
  onProgress: (p: BatchProgress) => void;
  /** After each success, before the next video. Stopped queues keep what finished. */
  onTracked: (videoId: string, result: TrackingResult) => void;
  /** Polled between videos and passed into each decode. */
  shouldStop: () => boolean;
}

export interface BatchSummary {
  outcomes: BatchOutcome[];
  stopped: boolean;
}

export async function trackBatch(
  items: readonly BatchItem[],
  params: ScoringParams,
  options: TrackingOptions,
  handlers: BatchHandlers,
): Promise<BatchSummary> {
  const outcomes: BatchOutcome[] = [];
  const total = items.length;

  for (let i = 0; i < total; i++) {
    const item = items[i];
    if (!item) continue;

    if (handlers.shouldStop()) {
      return { outcomes, stopped: true };
    }

    const index = i + 1;
    handlers.onProgress({
      index,
      total,
      fileName: item.fileName,
      fraction: 0,
      message: 'Starting',
    });

    try {
      const result = await trackVideo(
        item.file,
        item.map,
        params,
        options,
        (p) =>
          handlers.onProgress({
            index,
            total,
            fileName: item.fileName,
            fraction: p.fraction,
            message: p.message,
          }),
        handlers.shouldStop,
      );

      // Stop mid-decode: drop the partial track rather than score half a trial.
      if (handlers.shouldStop()) {
        outcomes.push({
          videoId: item.videoId,
          fileName: item.fileName,
          ok: false,
          note: `${item.fileName}: stopped part way through, so nothing was saved for this trial.`,
        });
        return { outcomes, stopped: true };
      }

      handlers.onTracked(item.videoId, result);

      const tracked = result.track.filter((p) => p.state === 'tracked').length;
      const fraction = result.track.length > 0 ? tracked / result.track.length : 0;
      outcomes.push({
        videoId: item.videoId,
        fileName: item.fileName,
        ok: true,
        note: `${item.fileName}: ${result.track.length} frames at ${result.achievedFps.toFixed(
          1,
        )} fps, ${(fraction * 100).toFixed(0)}% with a known position (${result.path}).`,
      });
    } catch (e) {
      outcomes.push({
        videoId: item.videoId,
        fileName: item.fileName,
        ok: false,
        note: `${item.fileName}: ${
          e instanceof Error ? e.message : 'tracking failed for an unknown reason'
        }`,
      });
    }
  }

  return { outcomes, stopped: false };
}
