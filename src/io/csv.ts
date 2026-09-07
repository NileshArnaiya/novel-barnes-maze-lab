import type { MazeEvent, Project, TrialSummary, VideoRecord } from '../core/types';

/**
 * Export.
 *
 * Two rules drive this file.
 *
 * First, tidy data: one row per observation, one column per variable, no merged
 * cells, no headers spanning columns. The output should drop into R or pandas
 * without cleaning, because the alternative is a scientist hand-editing the
 * spreadsheet, which is where transcription errors come from.
 *
 * Second, every export states how it was produced. Six months from now someone
 * will ask why two cohorts disagree, and the answer is often a threshold. The
 * parameters are written into the file, so the file can answer that question by
 * itself.
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
 * One row per trial. This is the file that goes into the statistics.
 *
 * Note the explicit `reached_target` and `escaped` boolean columns beside the
 * latency columns. An empty latency cell is ambiguous, and a downstream
 * analysis that reads a blank as zero would report a spectacularly fast animal.
 * The booleans make censoring unambiguous.
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
      ];
    });

  return rows(header, body);
}

/**
 * One row per scored event.
 *
 * This is what makes a disputed number checkable. If a reviewer doubts an error
 * count, this file tells them exactly which holes were scored and at which
 * frame, and those frame numbers are clickable in the app.
 */
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

/**
 * The parameter record. Written alongside every export.
 *
 * This file is what makes an analysis reproducible without the original
 * operator being available to ask.
 */
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
  // Revoking immediately can cancel the download in some browsers, so give the
  // click a moment to be handled first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The reloadable project file.
 *
 * Tracks are dropped for videos the user has not corrected, because a full
 * cohort of raw tracks is tens of megabytes and can be recomputed from the
 * video. Corrected tracks are always kept: those represent human work that
 * cannot be regenerated.
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
