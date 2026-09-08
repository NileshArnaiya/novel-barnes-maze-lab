import { cmToPx, distance, nearestHole } from './geometry';
import type { MazeEvent, MazeMap, ScoringParams, TrackPoint } from './types';

/**
 * Trajectory → events. Same track + params always gives the same events.
 */

/** Nose if we have it; body overcounts pass-bys as investigations. */
function scoringPoint(p: TrackPoint) {
  return p.nose ?? p.body;
}

/**
 * Hole investigations: dwell inside investigationRadiusCm for at least
 * investigationMinDwellS. Same hole inside the refractory window is one visit.
 */
export function detectInvestigations(
  track: readonly TrackPoint[],
  map: MazeMap,
  params: ScoringParams,
): MazeEvent[] {
  const radiusPx = cmToPx(map, params.investigationRadiusCm);
  const events: MazeEvent[] = [];

  let runHoleId: string | null = null;
  let runStart = -1;

  /** Emit the run if it was long enough. */
  const flush = (endIdx: number) => {
    if (runHoleId === null || runStart < 0) return;
    const first = track[runStart];
    const last = track[endIdx];
    if (!first || !last) return;

    const durationS = last.t - first.t;
    if (durationS < params.investigationMinDwellS) {
      runHoleId = null;
      runStart = -1;
      return;
    }

    const hole = map.holes.find((h) => h.id === runHoleId);
    if (!hole) {
      runHoleId = null;
      runStart = -1;
      return;
    }

    // Same hole, still inside refractory: extend the last event.
    const prev = events[events.length - 1];
    if (
      prev &&
      prev.holeId === hole.id &&
      first.t - prev.endT < params.investigationRefractoryS
    ) {
      prev.endFrame = last.frame;
      prev.endT = last.t;
    } else {
      events.push({
        kind: 'investigation',
        holeId: hole.id,
        holeIndex: hole.index,
        isTargetHole: hole.isTarget,
        startFrame: first.frame,
        endFrame: last.frame,
        startT: first.t,
        endT: last.t,
        provenance: 'auto',
      });
    }

    runHoleId = null;
    runStart = -1;
  };

  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    if (!p) continue;
    const pt = scoringPoint(p);

    // Untracked frames end the run; they cannot confirm a poke.
    if (p.state !== 'tracked' || !pt) {
      flush(i - 1);
      continue;
    }

    const near = nearestHole(map.holes, pt);
    const inside = near !== null && near.distPx <= radiusPx;

    if (!inside) {
      flush(i - 1);
      continue;
    }

    if (runHoleId === null) {
      runHoleId = near.hole.id;
      runStart = i;
    } else if (runHoleId !== near.hole.id) {
      // Switched holes without leaving the radius. Close one, open the other.
      flush(i - 1);
      runHoleId = near.hole.id;
      runStart = i;
    }
  }
  flush(track.length - 1);

  return events;
}

/**
 * Escape: vanished at the target and stayed gone for escapeConfirmFrames.
 * Last seen far from the target → tracking loss, not an escape.
 * Probe trials have no box, so this returns null.
 */
export function detectEscape(
  track: readonly TrackPoint[],
  map: MazeMap,
  params: ScoringParams,
  trialType: 'acquisition' | 'probe',
): MazeEvent | null {
  if (trialType === 'probe') return null;

  const target = map.holes.find((h) => h.isTarget);
  if (!target) return null;

  const radiusPx = cmToPx(map, params.reachedTargetRadiusCm);

  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    if (!p) continue;
    if (p.state !== 'in-target-hole') continue;

    // A real escape stays gone; a dropout comes back.
    let run = 0;
    let j = i;
    for (; j < track.length; j++) {
      const q = track[j];
      if (!q) break;
      if (q.state === 'in-target-hole' || q.state === 'lost') run++;
      else break;
    }
    if (run < params.escapeConfirmFrames) continue;

    // Last visible position should be near the target.
    const lastSeen = lastTrackedBefore(track, i);
    if (lastSeen) {
      const pt = scoringPoint(lastSeen);
      if (pt && distance(pt, target.center) > radiusPx * 2) continue;
    }

    return {
      kind: 'escape',
      holeId: target.id,
      holeIndex: target.index,
      isTargetHole: true,
      startFrame: p.frame,
      endFrame: p.frame,
      startT: p.t,
      endT: p.t,
      provenance: 'auto',
    };
  }
  return null;
}

/** Last frame before `idx` where the animal was visible. */
function lastTrackedBefore(
  track: readonly TrackPoint[],
  idx: number,
): TrackPoint | null {
  for (let i = idx - 1; i >= 0; i--) {
    const p = track[i];
    if (p && p.state === 'tracked') return p;
  }
  return null;
}

/**
 * First arrival at the target, even if it then left. That is primary latency.
 */
export function detectReachedTarget(
  track: readonly TrackPoint[],
  map: MazeMap,
  params: ScoringParams,
): MazeEvent | null {
  const target = map.holes.find((h) => h.isTarget);
  if (!target) return null;
  const radiusPx = cmToPx(map, params.reachedTargetRadiusCm);

  for (const p of track) {
    const pt = scoringPoint(p);
    if (p.state === 'in-target-hole') {
      return {
        kind: 'reached-target',
        holeId: target.id,
        holeIndex: target.index,
        isTargetHole: true,
        startFrame: p.frame,
        endFrame: p.frame,
        startT: p.t,
        endT: p.t,
        provenance: 'auto',
      };
    }
    if (p.state !== 'tracked' || !pt) continue;
    if (distance(pt, target.center) <= radiusPx) {
      return {
        kind: 'reached-target',
        holeId: target.id,
        holeIndex: target.index,
        isTargetHole: true,
        startFrame: p.frame,
        endFrame: p.frame,
        startT: p.t,
        endT: p.t,
        provenance: 'auto',
      };
    }
  }
  return null;
}

/** All detectors, sorted by time. */
export function detectAllEvents(
  track: readonly TrackPoint[],
  map: MazeMap,
  params: ScoringParams,
  trialType: 'acquisition' | 'probe',
): MazeEvent[] {
  const events: MazeEvent[] = [...detectInvestigations(track, map, params)];

  const reached = detectReachedTarget(track, map, params);
  if (reached) events.push(reached);

  const escape = detectEscape(track, map, params, trialType);
  if (escape) events.push(escape);

  return events.sort((a, b) => a.startT - b.startT);
}
