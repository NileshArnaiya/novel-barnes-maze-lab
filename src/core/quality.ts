import type { TrackPoint, VideoRecord } from './types';
import { trackedFraction } from './measures';

/**
 * Flag trials that need a look. In-hole frames are not gaps.
 */

export interface QualityReport {
  trackedFraction: number;
  /** Longest continuous run of lost frames. */
  longestGapFrames: number;
  longestGapS: number;
  /** Where the gaps are, so Review can jump to them. */
  gaps: { startFrame: number; endFrame: number; startT: number; endT: number }[];
  /** Null when nothing needs attention. */
  flag: string | null;
  /** Higher is worse. Used to sort the review queue. */
  priority: number;
}

/** Runs of consecutive `lost` frames. Frames inside a hole are not gaps. */
export function findGaps(track: readonly TrackPoint[]) {
  const gaps: QualityReport['gaps'] = [];
  let start = -1;
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    if (!p) continue;
    if (p.state === 'lost') {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const a = track[start];
      const b = track[i - 1];
      if (a && b) gaps.push({ startFrame: a.frame, endFrame: b.frame, startT: a.t, endT: b.t });
      start = -1;
    }
  }
  if (start >= 0) {
    const a = track[start];
    const b = track[track.length - 1];
    if (a && b) gaps.push({ startFrame: a.frame, endFrame: b.frame, startT: a.t, endT: b.t });
  }
  return gaps;
}

export function assessQuality(track: readonly TrackPoint[], fps: number): QualityReport {
  const frac = trackedFraction(track);
  const gaps = findGaps(track);

  let longestGapFrames = 0;
  for (const g of gaps) {
    const len = g.endFrame - g.startFrame + 1;
    if (len > longestGapFrames) longestGapFrames = len;
  }
  const longestGapS = fps > 0 ? longestGapFrames / fps : 0;

  // Readable cutoffs, not a fitted model. Change them here if the lab wants.
  let flag: string | null = null;
  let priority = 0;

  if (frac < 0.8) {
    flag = `Only ${(frac * 100).toFixed(0)}% of frames tracked. Check lighting and the background frame.`;
    priority = 3;
  } else if (longestGapS > 2) {
    flag = `A ${longestGapS.toFixed(1)}s stretch with no detection. Check whether the animal was in a hole.`;
    priority = 2;
  } else if (frac < 0.95) {
    flag = `${(frac * 100).toFixed(0)}% of frames tracked. Worth a look.`;
    priority = 1;
  }

  return { trackedFraction: frac, longestGapFrames, longestGapS, gaps, flag, priority };
}

/** Put flagged videos first. */
export function triageOrder(videos: readonly VideoRecord[]): VideoRecord[] {
  return [...videos].sort((a, b) => {
    const pa = a.qcFlag ? 1 : 0;
    const pb = b.qcFlag ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const fa = a.summary?.trackedFraction ?? 1;
    const fb = b.summary?.trackedFraction ?? 1;
    return fa - fb;
  });
}
