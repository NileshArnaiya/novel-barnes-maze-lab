import { cmToPx, distance, nearestHole } from './geometry';
import type { MazeEvent, MazeMap, ScoringParams, TrackPoint } from './types';

/**
 * Turn a trajectory into scored behavioural events.
 *
 * Everything here is deterministic and pure: same track plus same parameters
 * always gives the same events. That is what makes the threshold-sensitivity
 * sweep possible, and it is what lets a reviewer reproduce a number six months
 * later from the project file alone.
 */

/**
 * Which point on the animal to score against. If a nose estimate exists we use
 * it, because "did it poke its nose at the hole" is the actual behaviour. Body
 * centroid systematically overcounts errors: a mouse running past a hole has
 * its centroid pass within a few centimetres of it without ever inspecting it.
 */
function scoringPoint(p: TrackPoint) {
  return p.nose ?? p.body;
}

/**
 * Detect hole investigations.
 *
 * An investigation is a run of consecutive frames where the scoring point stays
 * within `investigationRadiusCm` of one hole, lasting at least
 * `investigationMinDwellS`. Two visits to the same hole inside the refractory
 * window are merged, so a mouse that lingers and jitters is not scored as five
 * separate errors.
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

  /** Close the current run and emit it if it is long enough. */
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

    // Refractory merge: if this is the same hole as the previous event and it
    // starts inside the refractory window, extend that event instead of adding
    // a new one.
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

    // A frame where we cannot see the animal cannot support or refute an
    // investigation, so it ends the current run rather than extending it.
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
      // Moved straight from one hole to an adjacent one without leaving the
      // radius. Close the first, open the second.
      flush(i - 1);
      runHoleId = near.hole.id;
      runStart = i;
    }
  }
  flush(track.length - 1);

  return events;
}

/**
 * Detect the escape: the animal entering the escape box under the target hole.
 *
 * This is the ambiguity at the heart of the task. The animal vanishing from
 * view is either the behaviour we are trying to measure or a failure of the
 * measurement, and the pixels look identical. We resolve it with context:
 *
 *   - vanished, last seen at the target hole, stayed vanished  -> escape
 *   - vanished, last seen anywhere else                        -> tracking loss
 *
 * The `escapeConfirmFrames` requirement stops a one-frame dropout over the
 * target hole from being scored as a successful escape.
 *
 * On probe trials there is no escape box, so this returns nothing.
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

    // Require the disappearance to persist. A real escape does not come back
    // two frames later; a dropout does.
    let run = 0;
    let j = i;
    for (; j < track.length; j++) {
      const q = track[j];
      if (!q) break;
      if (q.state === 'in-target-hole' || q.state === 'lost') run++;
      else break;
    }
    if (run < params.escapeConfirmFrames) continue;

    // Corroborate with the last place we actually saw the animal.
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

/** The most recent frame before `idx` where the animal was actually visible. */
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
 * First moment the animal reached the target hole, whether or not it entered.
 *
 * This is what primary latency is measured to. The edge case worth naming: an
 * animal can arrive at the target, hesitate, wander off and come back. We score
 * the first arrival, which is the standard convention and the one that reflects
 * memory rather than willingness to enter.
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

/** Run all detectors and return events sorted by time. */
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
