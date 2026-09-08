import { cohorts, learningCurve, strategyByDay, type CurveMeasure } from '../core/aggregate';
import type { MazeEvent, Project, TrialSummary, VideoRecord } from '../core/types';

/**
 * Tidy CSVs. Blank latency is never reached, not zero — see reached_target.
 * Parameters go in the file so the thresholds travel with the data.
 */

/** Escape a value for CSV. Quotes anything containing a delimiter or quote. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rows(header: readonly string[], body: readonly unknown[][]): string {
  const lines = [header.map(cell).join(',')];
  for (const r of body) lines.push(r.map(cell).join(','));
  return lines.join('\n');
}

/**
 * One row per trial. `reached_target` / `escaped` sit next to latency so a
 * blank cell cannot be read as zero.
 */
export function trialSummaryCsv(project: Project): string {
  const header = [
    'video_id',
    'file_name',
    'animal_id',
    'cohort',
    'day',
    'trial_type',
    'reached_target',
    'primary_latency_s',
    'escaped',
    'total_latency_s',
    'primary_errors',
    'total_errors',
    'path_length_cm',
    'mean_speed_cm_s',
    'target_quadrant_time_s',
    'strategy',
    'strategy_confidence',
    'strategy_source',
    'path_directness',
    'longest_serial_run',
    'thigmotaxis_fraction',
    'tracked_fraction',
    'human_edited_frames',
    'video_duration_s',
    'frame_rate_fps',
    'qc_flag',
  ];

  const body = project.videos
    .filter((v): v is VideoRecord & { summary: TrialSummary } => v.summary !== null)
    .map((v) => {
      const s = v.summary;
      return [
        v.id,
        v.fileName,
        s.animalId,
        s.cohort,
        s.day,
        s.trialType,
        s.primaryLatencyS !== null,
        s.primaryLatencyS?.toFixed(2) ?? '',
        s.totalLatencyS !== null,
        s.totalLatencyS?.toFixed(2) ?? '',
        s.primaryErrors,
        s.totalErrors,
        s.pathLengthCm.toFixed(1),
        s.meanSpeedCmS.toFixed(1),
        s.targetQuadrantTimeS.toFixed(2),
        s.strategy.label,
        s.strategy.confidence.toFixed(2),
        s.strategy.provenance,
        s.strategy.features.pathDirectness.toFixed(3),
        s.strategy.features.longestSerialRun,
        s.strategy.features.thigmotaxisFraction.toFixed(3),
        s.trackedFraction.toFixed(3),
        s.humanEditedFrames,
        v.durationS.toFixed(2),
        v.fps.toFixed(3),
        v.qcFlag ?? '',
      ];
    });

  return rows(header, body);
}

/** One row per event, with frame numbers that match Review. */
export function eventsCsv(project: Project): string {
  const header = [
    'video_id',
    'animal_id',
    'event',
    'hole_index',
    'is_target_hole',
    'start_frame',
    'end_frame',
    'start_s',
    'end_s',
    'duration_s',
    'source',
  ];

  const body: unknown[][] = [];
  for (const v of project.videos) {
    if (!v.events) continue;
    for (const e of v.events as MazeEvent[]) {
      body.push([
        v.id,
        v.animalId,
        e.kind,
        e.holeIndex ?? '',
        e.isTargetHole,
        e.startFrame,
        e.endFrame,
        e.startT.toFixed(3),
        e.endT.toFixed(3),
        (e.endT - e.startT).toFixed(3),
        e.provenance,
      ]);
    }
  }
  return rows(header, body);
}

/** Thresholds and tool version, so the file can answer "what settings were these?" */
export function parametersCsv(project: Project): string {
  const header = ['parameter', 'value'];
  const body: unknown[][] = [
    ['tool_version', project.toolVersion],
    ['schema_version', project.schemaVersion],
    ['exported_at', new Date().toISOString()],
    ['error_counting_convention', 'distinct non-target holes investigated'],
    ['movement_floor_cm_s', 1.0],
  ];
  for (const [k, v] of Object.entries(project.params)) body.push([k, v]);
  for (const vid of project.videos) {
    const target = vid.map?.holes.find((h) => h.isTarget);
    if (target) body.push([`target_hole_index:${vid.fileName}`, target.index]);
  }
  return rows(header, body);
}

export function learningCurveCsv(project: Project): string {
  const measures: CurveMeasure[] = [
    'primaryLatencyS',
    'totalLatencyS',
    'primaryErrors',
    'totalErrors',
    'pathLengthCm',
  ];
  const header = ['cohort', 'day', 'measure', 'mean', 'sem', 'n', 'n_censored'];
  const body: unknown[][] = [];
  for (const measure of measures) {
    for (const p of learningCurve(project, measure)) {
      body.push([p.cohort, p.day, measure, p.mean.toFixed(4), p.sem.toFixed(4), p.n, p.nCensored]);
    }
  }
  return rows(header, body);
}

export function strategyByDayCsv(project: Project): string {
  const header = ['cohort', 'day', 'spatial', 'serial', 'random', 'undetermined'];
  const body: unknown[][] = [];
  for (const cohort of cohorts(project)) {
    for (const row of strategyByDay(project, cohort)) {
      body.push([
        cohort,
        row.day,
        row.counts.spatial,
        row.counts.serial,
        row.counts.random,
        row.counts.undetermined,
      ]);
    }
  }
  return rows(header, body);
}

/** Trigger a download without a server round trip. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Immediate revoke can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Reloadable project. Uncorrected tracks are dropped (they can be recomputed).
 * Human-edited tracks are kept.
 */
export function projectJson(project: Project): string {
  const slim: Project = {
    ...project,
    videos: project.videos.map((v) => ({
      ...v,
      track: v.track && v.track.some((p) => p.provenance === 'human') ? v.track : null,
    })),
  };
  return JSON.stringify(slim, null, 2);
}
