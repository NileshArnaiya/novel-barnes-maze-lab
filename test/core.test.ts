import { describe, expect, it } from 'vitest';
import { analyze, sweepParam } from '../src/core/analyze';
import { detectEscape, detectInvestigations } from '../src/core/events';
import { distance, pixelsPerCm, quadrantOf, registerMap, ringDistance, rotateMap } from '../src/core/geometry';
import { pathLengthCm, primaryErrors, trackedFraction } from '../src/core/measures';
import { DEFAULT_PARAMS } from '../src/core/params';
import { classifyStrategy, longestSerialRun } from '../src/core/strategy';
import { assessQuality } from '../src/core/quality';
import { buildPayload } from '../src/io/explain';
import type { TrackPoint } from '../src/core/types';
import { absent, concat, dwell, FPS, makeMap, makeVideo, straightLine } from './fixtures';

const map = makeMap();
const video = makeVideo();
const target = map.holes.find((h) => h.isTarget)!;

describe('geometry', () => {
  it('derives the pixel scale from the platform', () => {
    // 400 px radius, 100 cm diameter, so 800 px across 100 cm.
    expect(pixelsPerCm(map)).toBeCloseTo(8, 6);
  });

  it('treats the ring as circular when measuring hole adjacency', () => {
    // Holes 0 and 19 are neighbours on a 20-hole ring, not 19 apart.
    expect(ringDistance(0, 19, 20)).toBe(1);
    expect(ringDistance(3, 7, 20)).toBe(4);
  });

  it('puts the target hole in quadrant 0', () => {
    expect(quadrantOf(map, target.center)).toBe(0);
  });

  it('rotates holes around the platform without renumbering them', () => {
    const hole0 = map.holes[0]!;
    const moved = rotateMap(map, Math.PI / 2);
    expect(moved.holes[0]!.id).toBe(hole0.id);
    expect(moved.holes[0]!.isTarget).toBe(true);
    expect(distance(moved.platformCenter, moved.holes[0]!.center)).toBeCloseTo(
      distance(map.platformCenter, hole0.center),
      6,
    );
    // startAngle 0: hole 0 is to the right. After +pi/2 it sits at the top.
    expect(moved.holes[0]!.center.x).toBeCloseTo(map.platformCenter.x, 6);
    expect(moved.holes[0]!.center.y).toBeCloseTo(map.platformCenter.y - 350, 6);
  });

  it('registers a map onto a shifted, rescaled platform', () => {
    const moved = registerMap(map, { x: 600, y: 520 }, 380);
    expect(moved.holes).toHaveLength(20);
    expect(moved.origin).toBe('registered');

    // Hole spacing must scale with the platform, otherwise the transferred
    // holes drift off the real ones.
    const scale = 380 / map.platformRadiusPx;
    const original = distance(map.holes[0]!.center, map.holes[1]!.center);
    const transferred = distance(moved.holes[0]!.center, moved.holes[1]!.center);
    expect(transferred).toBeCloseTo(original * scale, 4);
  });
});

describe('path length', () => {
  it('measures a straight line as its true length', () => {
    // 800 px is exactly 100 cm at this scale.
    const track = straightLine({ x: 100, y: 500 }, { x: 900, y: 500 }, 100);
    expect(pathLengthCm(track, map)).toBeCloseTo(100, 3);
  });

  it('does not bridge a gap it cannot see across', () => {
    // Two 400 px segments with an unobserved jump between them. The honest
    // answer is 50 cm + 50 cm, not the 100 cm a naive straight-line bridge
    // would report by inventing the missing motion.
    const track = concat(
      straightLine({ x: 100, y: 500 }, { x: 500, y: 500 }, 50),
      absent(30, 0),
      straightLine({ x: 500, y: 900 }, { x: 900, y: 900 }, 50),
    );
    expect(pathLengthCm(track, map)).toBeCloseTo(100, 3);
  });
});

describe('investigations', () => {
  it('scores a dwell at a hole and ignores a pass-by', () => {
    const hole5 = map.holes[5]!;
    const hole9 = map.holes[9]!;

    const track = concat(
      // Two seconds sitting at hole 5: a genuine investigation.
      dwell(hole5.center, FPS * 2, 0),
      // Straight through hole 9 in three frames: too brief to score.
      straightLine(
        { x: hole9.center.x - 200, y: hole9.center.y },
        { x: hole9.center.x + 200, y: hole9.center.y },
        3,
      ),
    );

    const events = detectInvestigations(track, map, DEFAULT_PARAMS);
    expect(events).toHaveLength(1);
    expect(events[0]!.holeIndex).toBe(5);
  });

  it('merges jitter at one hole into a single visit', () => {
    const hole7 = map.holes[7]!;
    // Leaves the radius for two frames in the middle. Without the refractory
    // rule this scores as two errors for one behaviour.
    const track = concat(
      dwell(hole7.center, FPS, 0),
      straightLine(hole7.center, { x: hole7.center.x + 40, y: hole7.center.y }, 2),
      dwell(hole7.center, FPS, 0),
    );
    const events = detectInvestigations(track, map, DEFAULT_PARAMS);
    expect(events).toHaveLength(1);
  });
});

describe('occlusion', () => {
  it('reads a disappearance at the target as an escape', () => {
    const track = concat(
      straightLine({ x: 500, y: 500 }, target.center, 60),
      absent(FPS, 0, 'in-target-hole'),
    );
    const escape = detectEscape(track, map, DEFAULT_PARAMS, 'acquisition');
    expect(escape).not.toBeNull();
    expect(escape!.isTargetHole).toBe(true);
  });

  it('does not invent an escape from a tracking failure', () => {
    // Same structure, but the animal vanished in the middle of the platform.
    // Nothing about this is an escape and the tool must not claim one.
    const track = concat(
      straightLine({ x: 200, y: 500 }, { x: 500, y: 500 }, 60),
      absent(FPS * 2, 0, 'lost'),
    );
    expect(detectEscape(track, map, DEFAULT_PARAMS, 'acquisition')).toBeNull();
  });

  it('has no escape on a probe trial', () => {
    const track = concat(
      straightLine({ x: 500, y: 500 }, target.center, 60),
      absent(FPS, 0, 'in-target-hole'),
    );
    expect(detectEscape(track, map, DEFAULT_PARAMS, 'probe')).toBeNull();
  });

  it('counts frames inside a hole as observed, not as lost tracking', () => {
    // We know exactly where the animal is when it is down a hole. Scoring that
    // as a tracking failure would flag good trials for pointless review.
    const track = concat(dwell(target.center, 30, 0), absent(30, 0, 'in-target-hole'));
    expect(trackedFraction(track)).toBe(1);
  });
});

describe('strategy', () => {
  it('calls a beeline spatial', () => {
    const track = concat(straightLine({ x: 500, y: 500 }, target.center, 60));
    const { events, summary } = analyze(video, track, map, DEFAULT_PARAMS);
    expect(events.some((e) => e.kind === 'reached-target')).toBe(true);
    expect(summary.strategy.label).toBe('spatial');
    expect(summary.strategy.reasoning.length).toBeGreaterThan(0);
  });

  it('calls a walk around the ring serial, not spatial', () => {
    // An animal that works round the ring can arrive at the target on a fairly
    // direct-looking final leg. Scoring that as spatial would overstate its
    // memory, so serial must be checked first.
    const segments = [];
    for (let i = 6; i >= 1; i--) segments.push(dwell(map.holes[i]!.center, FPS, 0));
    segments.push(dwell(target.center, FPS, 0));
    const track = concat(...segments);

    const { summary } = analyze(video, track, map, DEFAULT_PARAMS);
    expect(summary.strategy.label).toBe('serial');
  });

  it('finds the longest run of neighbouring holes', () => {
    const events = [4, 5, 6, 7, 12, 13].map((i) => ({
      kind: 'investigation' as const,
      holeId: `hole-${i}`,
      holeIndex: i,
      isTargetHole: false,
      startFrame: i,
      endFrame: i,
      startT: i,
      endT: i,
      provenance: 'auto' as const,
    }));
    expect(longestSerialRun(events, 20)).toBe(4);
  });

  it('refuses to classify a trial with no search in it', () => {
    const track = concat(dwell({ x: 500, y: 500 }, FPS * 5, 0));
    const result = classifyStrategy(track, [], map);
    expect(result.label).toBe('undetermined');
    expect(result.confidence).toBe(0);
  });
});

describe('errors', () => {
  it('counts distinct wrong holes before the target is reached', () => {
    const track = concat(
      dwell(map.holes[5]!.center, FPS, 0),
      dwell(map.holes[9]!.center, FPS, 0),
      dwell(map.holes[5]!.center, FPS, 0), // revisit: same error, not a new one
      dwell(target.center, FPS, 0),
      dwell(map.holes[14]!.center, FPS, 0), // after the target: not a primary error
    );
    const { events } = analyze(video, track, map, DEFAULT_PARAMS);
    expect(primaryErrors(events)).toBe(2);
  });
});

describe('quality triage', () => {
  it('flags a badly tracked trial and locates the gap', () => {
    const track = concat(
      straightLine({ x: 100, y: 500 }, { x: 400, y: 500 }, 30),
      absent(120, 0, 'lost'),
      straightLine({ x: 400, y: 500 }, { x: 700, y: 500 }, 30),
    );
    const q = assessQuality(track, FPS);
    expect(q.flag).not.toBeNull();
    expect(q.gaps).toHaveLength(1);
    expect(q.longestGapS).toBeCloseTo(4, 1);
  });

  it('does not flag a clean trial', () => {
    const track = concat(straightLine({ x: 100, y: 500 }, { x: 900, y: 500 }, 200));
    expect(assessQuality(track, FPS).flag).toBeNull();
  });
});

describe('parameter sensitivity', () => {
  it('shows how the error count moves with the investigation radius', () => {
    // The point of the sweep: a result that swings across the plausible range
    // of a threshold is not a finding. This test proves the sweep responds.
    const track = concat(
      dwell(map.holes[5]!.center, FPS, 0),
      straightLine(map.holes[5]!.center, map.holes[9]!.center, 60),
      dwell(map.holes[9]!.center, FPS, 0),
      dwell(target.center, FPS, 0),
    );
    const sweep = sweepParam(video, track, map, DEFAULT_PARAMS, 'investigationRadiusCm', [1, 3, 6]);
    expect(sweep).toHaveLength(3);
    const counts = sweep.map((s) => s.summary.totalErrors);
    // Wider radius can only catch the same holes or more, never fewer.
    expect(counts[2]!).toBeGreaterThanOrEqual(counts[0]!);
  });

  it('is deterministic: the same inputs give the same numbers', () => {
    const track = concat(straightLine({ x: 500, y: 500 }, target.center, 60));
    const a = analyze(video, track, map, DEFAULT_PARAMS).summary;
    const b = analyze(video, track, map, DEFAULT_PARAMS).summary;
    expect(a).toEqual(b);
  });
});

describe('human decisions survive rescoring', () => {
  it('keeps a strategy override when a threshold changes', () => {
    // Regression test for a real defect: the override was written into
    // `summary`, which is regenerated from the track and the parameters
    // whenever either changes, so the human decision was silently discarded on
    // the next slider drag. A human decision has to be an input to scoring.
    const track = concat(straightLine({ x: 500, y: 500 }, target.center, 60));
    const overridden = makeVideo({ strategyOverride: 'serial' });

    const a = analyze(overridden, track, map, DEFAULT_PARAMS).summary;
    expect(a.strategy.label).toBe('serial');
    expect(a.strategy.provenance).toBe('human');

    // Changing an unrelated threshold must not revert it.
    const b = analyze(
      overridden,
      track,
      map,
      { ...DEFAULT_PARAMS, investigationRadiusCm: 6 },
    ).summary;
    expect(b.strategy.label).toBe('serial');

    // The automatic reasoning is kept, so a reviewer can see what was disagreed
    // with rather than only the conclusion.
    expect(a.strategy.reasoning.join(' ')).toContain('overriding the automatic label');
  });

  it('records an override even when it matches the automatic label', () => {
    // The dropdown is bound to the displayed label, so selecting the label
    // already shown must still register as a human decision. Otherwise the
    // control silently does nothing whenever the user agrees with the tool.
    const track = concat(straightLine({ x: 500, y: 500 }, target.center, 60));
    const auto = analyze(makeVideo({ strategyOverride: null }), track, map, DEFAULT_PARAMS).summary;
    expect(auto.strategy.label).toBe('spatial');
    expect(auto.strategy.provenance).toBe('auto');

    const confirmed = analyze(makeVideo({ strategyOverride: 'spatial' }), track, map, DEFAULT_PARAMS).summary;
    expect(confirmed.strategy.label).toBe('spatial');
    expect(confirmed.strategy.provenance).toBe('human');
  });

  it('falls back to the automatic label when the override is cleared', () => {
    const track = concat(straightLine({ x: 500, y: 500 }, target.center, 60));
    const s = analyze(makeVideo({ strategyOverride: null }), track, map, DEFAULT_PARAMS).summary;
    expect(s.strategy.label).toBe('spatial');
    expect(s.strategy.provenance).toBe('auto');
  });
});

describe('movement floor', () => {
  it('does not count stationary tracking jitter as distance travelled', () => {
    // Regression test for a real defect. A resting animal's centroid moves a
    // pixel or two per frame; at 30 fps that added roughly a hundred pixels of
    // path that never happened, which inflated path length and collapsed path
    // directness, so genuinely direct trials classified as random.
    const at = { x: 500, y: 500 };
    const jitter: TrackPoint[] = [];
    for (let i = 0; i < 300; i++) {
      const dx = (i % 3) - 1; // ±1 px, well under the floor
      jitter.push({
        frame: i,
        t: i / FPS,
        state: 'tracked',
        body: { x: at.x + dx, y: at.y - dx },
        nose: null,
        confidence: 1,
        provenance: 'auto',
      });
    }
    // Ten seconds of sitting still must be close to zero distance, not metres.
    expect(pathLengthCm(jitter, map)).toBeLessThan(1);
  });

  it('still measures real movement accurately', () => {
    // The floor must not eat genuine locomotion. 800 px is exactly 100 cm here,
    // and each step is far above the floor.
    const track = straightLine({ x: 100, y: 500 }, { x: 900, y: 500 }, 100);
    expect(pathLengthCm(track, map)).toBeCloseTo(100, 3);
  });
});

describe('explainer payload', () => {
  it('never contains anything that could identify or reconstruct the recording', () => {
    // This test exists because the privacy claim in the README has to be
    // enforceable, not just written down. If someone later adds a field to the
    // payload that carries a filename, an animal id or coordinates, this fails.
    const track = concat(straightLine({ x: 500, y: 500 }, target.center, 60));
    const video = makeVideo({ animalId: 'M-SECRET-042', fileName: 'private-cohort.mp4' });
    const { summary } = analyze(video, track, map, DEFAULT_PARAMS);

    const payload = buildPayload({
      summary,
      quality: assessQuality(track, FPS),
      params: DEFAULT_PARAMS,
      trialType: 'acquisition',
      holeCount: 20,
      durationS: 60,
    });

    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain('M-SECRET-042');
    expect(serialised).not.toContain('private-cohort');
    expect(serialised).not.toContain('.mp4');

    // No coordinates and no per-frame data, only aggregates.
    expect(payload).not.toHaveProperty('track');
    expect(payload).not.toHaveProperty('body');
    expect(payload).not.toHaveProperty('videoId');
    expect(payload).not.toHaveProperty('gaps');
    expect(Object.keys(payload)).not.toContain('animalId');
    expect(Object.keys(payload)).not.toContain('fileName');

    expect(payload.duration_s).toBe(60);
    expect(typeof payload.not_visible_s).toBe('number');

    // And it is small: a payload that grew to thousands of characters would
    // mean something structural slipped in.
    expect(serialised.length).toBeLessThan(2500);
  });

  it('counts lost frames as not visible and leaves in-hole time out of that number', () => {
    // 30 lost frames at 30 fps is 1.0 s. In-hole frames are known, not lost.
    const track = concat(
      straightLine({ x: 500, y: 500 }, target.center, 30),
      absent(30, 30, 'lost'),
      absent(30, 60, 'in-target-hole'),
    );
    const video = makeVideo({ durationS: 3 });
    const { summary } = analyze(video, track, map, DEFAULT_PARAMS);
    const payload = buildPayload({
      summary,
      quality: assessQuality(track, FPS),
      params: DEFAULT_PARAMS,
      trialType: 'acquisition',
      holeCount: 20,
      durationS: 3,
    });

    expect(payload.not_visible_s).toBe(1);
    expect(payload.duration_s).toBe(3);
    expect(JSON.stringify(payload)).not.toContain('"x":');
  });
});
