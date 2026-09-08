import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyze';
import { DEFAULT_PARAMS } from '../src/core/params';
import { buildExampleProject } from '../src/demo/exampleCohort';
import { packFiles, zipPack } from '../src/io/exportPack';
import {
  cohortComparisonSvg,
  holeVisitRasterSvg,
  learningCurveSvg,
  strategyByDaySvg,
  timeColoredPathSvg,
} from '../src/io/figures';
import { buildReportPdf } from '../src/io/report';
import { absent, concat, dwell, makeMap, makeVideo, straightLine } from './fixtures';

const map = makeMap();

describe('time-colored path', () => {
  it('uses more than one stroke colour and does not draw across a lost gap', () => {
    const track = concat(
      straightLine({ x: 200, y: 500 }, { x: 400, y: 500 }, 20),
      absent(15, 0, 'lost'),
      straightLine({ x: 600, y: 500 }, { x: 800, y: 500 }, 20),
    );
    const svg = timeColoredPathSvg(track, map);

    const colors = new Set([...svg.matchAll(/stroke="rgb\([^"]+\)"/g)].map((m) => m[0]));
    expect(colors.size).toBeGreaterThan(1);

    // Consecutive tracked pairs only. 20+20 path strokes, not a bridge across
    // 15 lost frames. The extra <line> in the SVG is the 10 cm scale bar.
    const lines = svg.match(/<line [^>]*stroke-linecap="round"/g) ?? [];
    expect(lines.length).toBe(40);

    expect(svg).not.toMatch(/L600/);
  });
});

describe('hole-visit raster', () => {
  it('draws one bar per investigation at the right hole index', () => {
    const target = map.holes.find((h) => h.isTarget)!;
    const other = map.holes.find((h) => !h.isTarget)!;
    const track = concat(
      dwell(other.center, 20, 0),
      straightLine(other.center, target.center, 10),
      dwell(target.center, 20, 0),
    );
    const video = makeVideo({ durationS: track.length / 30, map });
    const { events } = analyze(video, track, map, DEFAULT_PARAMS);
    const investigations = events.filter((e) => e.kind === 'investigation');
    expect(investigations.length).toBeGreaterThan(0);

    const svg = holeVisitRasterSvg(events, map, video.durationS);
    const bars = svg.match(/<rect [^>]*rx="1"/g) ?? [];
    expect(bars.length).toBe(investigations.length);

    for (const e of investigations) {
      expect(svg).toContain(`>${e.holeIndex}${e.isTargetHole ? ' target' : ''}<`);
    }
  });
});

describe('cohort figures and pack', () => {
  it('draws cohort comparison and strategy stacks from the example project', () => {
    const project = buildExampleProject();
    const days = new Set(project.videos.map((v) => v.day));
    const groups = new Set(project.videos.map((v) => v.cohort));
    expect(days.size).toBeGreaterThanOrEqual(2);
    expect(groups.size).toBeGreaterThanOrEqual(2);

    expect(learningCurveSvg(project, 'primaryLatencyS')).toContain('<path');
    expect(cohortComparisonSvg(project, 'primaryLatencyS')).toContain('opacity="0.35"');
    expect(strategyByDaySvg(project)).toContain('spatial');
  });

  it('does not draw a learning curve from a single day and cohort', () => {
    const full = buildExampleProject();
    const one = { ...full, videos: full.videos.slice(0, 1) };
    expect(learningCurveSvg(one, 'primaryLatencyS')).toBeNull();
    expect(cohortComparisonSvg(one, 'primaryLatencyS')).toBeNull();
  });

  it('builds a ZIP with the tidy CSVs, figures, and a PDF', async () => {
    const project = buildExampleProject();
    const pdf = await buildReportPdf(project);
    expect(pdf.byteLength).toBeGreaterThan(500);
    expect(String.fromCharCode(pdf[0]!, pdf[1]!, pdf[2]!, pdf[3]!)).toBe('%PDF');

    const files = packFiles(project, pdf);
    const names = files.map((f) => f.path);
    expect(names).toContain('barnes-trials.csv');
    expect(names).toContain('barnes-events.csv');
    expect(names).toContain('barnes-parameters.csv');
    expect(names).toContain('barnes-report.pdf');
    expect(names).toContain('barnes-learning-curve.csv');
    expect(names).toContain('barnes-strategy-by-day.csv');
    expect(names.some((n) => n.endsWith('-time-path.svg'))).toBe(true);
    expect(names.some((n) => n.endsWith('-hole-raster.svg'))).toBe(true);
    expect(names).toContain('figures/cohort-comparison.svg');

    const zip = zipPack(files);
    const unpacked = unzipSync(zip);
    expect(strFromU8(unpacked['barnes-trials.csv']!).split('\n')[0]).toContain('animal_id');
  });
});
