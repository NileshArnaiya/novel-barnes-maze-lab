import { MOVEMENT_FLOOR_CM_S } from '../core/measures';
import type { Project, TrialSummary, VideoRecord } from '../core/types';

/**
 * Excel workbook. Seven sheets:
 *   measurements, subjects, events, group summary, data dictionary, methods, parameters.
 */

const TOOL = 'Barnes maze scorer';

type Scored = VideoRecord & { summary: TrialSummary };

function scoredTrials(project: Project): Scored[] {
  return project.videos.filter((v): v is Scored => v.summary !== null);
}

/** Sheet 1: one row per trial. */
function measurementsSheet(project: Project) {
  return scoredTrials(project).map((v) => {
    const s = v.summary;
    return {
      animal_id: s.animalId,
      cohort: s.cohort,
      day: s.day ?? '',
      trial_type: s.trialType,
      video_file: v.fileName,
      video_duration_s: Number(v.durationS.toFixed(2)),
      frame_rate_fps: v.fps,
      reached_target: s.primaryLatencyS !== null,
      primary_latency_s: s.primaryLatencyS !== null ? Number(s.primaryLatencyS.toFixed(2)) : '',
      escaped: s.totalLatencyS !== null,
      total_latency_s: s.totalLatencyS !== null ? Number(s.totalLatencyS.toFixed(2)) : '',
      primary_errors: s.primaryErrors,
      total_errors: s.totalErrors,
      path_length_cm: Number(s.pathLengthCm.toFixed(1)),
      mean_speed_cm_s: Number(s.meanSpeedCmS.toFixed(2)),
      target_quadrant_time_s: Number(s.targetQuadrantTimeS.toFixed(2)),
      search_strategy: s.strategy.label,
      strategy_confidence: Number(s.strategy.confidence.toFixed(2)),
      strategy_source: s.strategy.provenance,
      path_directness: Number(s.strategy.features.pathDirectness.toFixed(3)),
      longest_serial_run: s.strategy.features.longestSerialRun,
      thigmotaxis_fraction: Number(s.strategy.features.thigmotaxisFraction.toFixed(3)),
      tracked_fraction: Number(s.trackedFraction.toFixed(3)),
      human_edited_frames: s.humanEditedFrames,
      qc_flag: v.qcFlag ?? '',
    };
  });
}

/**
 * Sheet 2: one row per animal. Sex / genotype / treatment are blank for the user to fill.
 */
function subjectsSheet(project: Project) {
  const byAnimal = new Map<string, Scored[]>();
  for (const v of scoredTrials(project)) {
    const list = byAnimal.get(v.summary.animalId) ?? [];
    list.push(v);
    byAnimal.set(v.summary.animalId, list);
  }

  return [...byAnimal.entries()].map(([animalId, trials]) => ({
    animal_id: animalId,
    cohort: trials[0]?.summary.cohort ?? '',
    // Not in the video. Fill these here, not on every trial row.
    sex: '',
    genotype: '',
    treatment: '',
    n_trials: trials.length,
    days_run: [...new Set(trials.map((t) => t.summary.day).filter((d) => d !== null))].join(';'),
  }));
}

/** Sheet 3: one row per event, with frames. */
function eventsSheet(project: Project) {
  const rows: Record<string, unknown>[] = [];
  for (const v of project.videos) {
    if (!v.events) continue;
    for (const e of v.events) {
      rows.push({
        animal_id: v.animalId,
        day: v.day ?? '',
        video_file: v.fileName,
        event: e.kind,
        hole_index: e.holeIndex ?? '',
        is_target_hole: e.isTargetHole,
        start_frame: e.startFrame,
        end_frame: e.endFrame,
        start_s: Number(e.startT.toFixed(3)),
        end_s: Number(e.endT.toFixed(3)),
        duration_s: Number((e.endT - e.startT).toFixed(3)),
        source: e.provenance,
      });
    }
  }
  return rows;
}

/**
 * Sheet 4: group mean, SD, SEM, n. Censored trials counted separately, not averaged in.
 */
function summarySheet(project: Project) {
  const groups = new Map<string, Scored[]>();
  for (const v of scoredTrials(project)) {
    const key = `${v.summary.cohort}|${v.summary.day ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(v);
    groups.set(key, list);
  }

  const stat = (values: number[]) => {
    const n = values.length;
    if (n === 0) return { mean: '', sd: '', sem: '', n: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / n;
    // Sample SD (n-1).
    const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
    const sd = Math.sqrt(variance);
    return {
      mean: Number(mean.toFixed(3)),
      sd: Number(sd.toFixed(3)),
      sem: n > 1 ? Number((sd / Math.sqrt(n)).toFixed(3)) : '',
      n,
    };
  };

  const rows: Record<string, unknown>[] = [];
  for (const [key, trials] of groups) {
    const [cohort, day] = key.split('|');
    const measures: [string, (t: Scored) => number | null][] = [
      ['primary_latency_s', (t) => t.summary.primaryLatencyS],
      ['total_latency_s', (t) => t.summary.totalLatencyS],
      ['primary_errors', (t) => t.summary.primaryErrors],
      ['total_errors', (t) => t.summary.totalErrors],
      ['path_length_cm', (t) => t.summary.pathLengthCm],
      ['mean_speed_cm_s', (t) => t.summary.meanSpeedCmS],
      ['target_quadrant_time_s', (t) => t.summary.targetQuadrantTimeS],
    ];

    for (const [name, get] of measures) {
      const all = trials.map(get);
      const present = all.filter((x): x is number => x !== null);
      const s = stat(present);
      rows.push({
        cohort,
        day,
        measure: name,
        mean: s.mean,
        sd: s.sd,
        sem: s.sem,
        n: s.n,
        n_censored: all.length - present.length,
      });
    }

    // Strategy is categorical, so it gets counts rather than a mean.
    for (const label of ['spatial', 'serial', 'random', 'undetermined']) {
      const count = trials.filter((t) => t.summary.strategy.label === label).length;
      rows.push({
        cohort,
        day,
        measure: `strategy_${label}_count`,
        mean: count,
        sd: '',
        sem: '',
        n: trials.length,
        n_censored: 0,
      });
    }
  }
  return rows;
}

/** Sheet 5: what each column means. */
function dictionarySheet(project: Project) {
  const p = project.params;
  return [
    {
      variable: 'animal_id',
      definition: 'Subject identifier, parsed from the video filename and editable in the tool.',
      unit: '',
      notes: 'Check these before analysis. Filename parsing is a guess.',
    },
    {
      variable: 'trial_type',
      definition: 'acquisition (escape box present) or probe (escape box removed).',
      unit: '',
      notes: 'Escape events and total latency are undefined on probe trials.',
    },
    {
      variable: 'reached_target',
      definition: 'Whether the animal ever came within the reached-target radius of the escape hole.',
      unit: 'boolean',
      notes: 'Read this before primary_latency_s. A blank latency means never reached, not zero.',
    },
    {
      variable: 'primary_latency_s',
      definition: `Time from trial start until the animal first came within ${p.reachedTargetRadiusCm} cm of the target hole centre.`,
      unit: 's',
      notes: 'First arrival is scored, even if the animal then left and returned.',
    },
    {
      variable: 'escaped',
      definition: 'Whether the animal entered the escape box.',
      unit: 'boolean',
      notes: 'Always FALSE on probe trials by construction.',
    },
    {
      variable: 'total_latency_s',
      definition: 'Time from trial start until the animal entered the escape box.',
      unit: 's',
      notes: `Scored as a disappearance at the target hole lasting at least ${p.escapeConfirmFrames} frames, corroborated by the last visible position.`,
    },
    {
      variable: 'primary_errors',
      definition: 'Number of distinct non-target holes investigated before the target was first reached.',
      unit: 'count',
      notes: 'Distinct holes, not total visits. Revisiting the same wrong hole counts once. Some published protocols count every visit instead, which gives larger numbers.',
    },
    {
      variable: 'total_errors',
      definition: 'Number of distinct non-target holes investigated across the whole trial.',
      unit: 'count',
      notes: `An investigation is at least ${p.investigationMinDwellS} s within ${p.investigationRadiusCm} cm of a hole centre, scored from the nose where available.`,
    },
    {
      variable: 'path_length_cm',
      definition: 'Total distance travelled by the tracked body centroid.',
      unit: 'cm',
      notes: 'Frames where the animal was not visible are skipped, not interpolated across. This under-reports rather than inventing distance. Read alongside tracked_fraction.',
    },
    {
      variable: 'mean_speed_cm_s',
      definition: 'Mean instantaneous speed over frames where the animal was moving.',
      unit: 'cm/s',
      notes: `Frames below ${MOVEMENT_FLOOR_CM_S} cm/s are excluded, so this is speed while moving rather than speed averaged over stationary periods.`,
    },
    {
      variable: 'target_quadrant_time_s',
      definition: 'Time spent in the 90 degree quadrant centred on the target hole.',
      unit: 's',
      notes: 'Quadrants are defined relative to the target hole, not the image axes, so the measure is comparable between animals with different target holes.',
    },
    {
      variable: 'search_strategy',
      definition: 'spatial, serial, random, or undetermined.',
      unit: 'category',
      notes: 'Rule-based classification over path directness, hole-visit sequence and quadrant occupancy. Serial is tested before spatial. See docs/measures.md and Illouz et al. 2016 for the SVM approach this approximates.',
    },
    {
      variable: 'strategy_source',
      definition: 'auto if the classifier produced the label, human if a person overrode it.',
      unit: '',
      notes: 'Consider reporting how many labels were overridden.',
    },
    {
      variable: 'path_directness',
      definition: 'Straight-line distance from start to target divided by distance actually travelled to reach it.',
      unit: 'ratio 0 to 1',
      notes: '1 is a perfect beeline. Measured only up to first target arrival.',
    },
    {
      variable: 'longest_serial_run',
      definition: 'Longest run of ring-adjacent holes investigated consecutively.',
      unit: 'count',
      notes: 'The signature of serial search. Direction reversals are permitted within a run.',
    },
    {
      variable: 'thigmotaxis_fraction',
      definition: 'Fraction of visible time spent within 5 cm of the platform edge.',
      unit: 'fraction 0 to 1',
      notes: 'An anxiety readout that mimics poor memory in latency and error counts. Worth checking before interpreting a group difference as a memory effect.',
    },
    {
      variable: 'tracked_fraction',
      definition: 'Fraction of frames where the animal position was known.',
      unit: 'fraction 0 to 1',
      notes: 'Frames inside a hole count as known. Only unexplained frames count against this. Low values mean the other measures on that row are less reliable.',
    },
    {
      variable: 'human_edited_frames',
      definition: 'Number of frames a person corrected by hand.',
      unit: 'count',
      notes: 'Provenance. Report this if a reviewer asks how much of the tracking was manual.',
    },
    {
      variable: 'Experimental unit',
      definition: 'One row in the Measurements sheet is one trial, not one animal.',
      unit: '',
      notes: 'Multiple trials per animal are not independent. Use a mixed model or average within animal before a between-group test.',
    },
  ];
}

/**
 * Sheet 6: methods paragraph built from the settings actually used.
 */
function methodsSheet(project: Project) {
  const p = project.params;
  const trials = scoredTrials(project);
  const animals = new Set(trials.map((t) => t.summary.animalId)).size;
  const fps = trials[0]?.fps ?? 30;
  const diameter = trials.find((t) => t.map)?.map?.platformDiameterCm ?? null;
  const holes = trials.find((t) => t.map)?.map?.holes.length ?? null;

  const text = [
    `Behaviour was recorded at ${fps} frames per second${
      diameter ? ` on a ${diameter} cm diameter Barnes maze platform` : ''
    }${holes ? ` with ${holes} holes` : ''}. Videos were scored using ${TOOL} v${project.toolVersion}.`,
    `Animal position was tracked and hole investigations were defined as the nose remaining within ${p.investigationRadiusCm} cm of a hole centre for at least ${p.investigationMinDwellS} s, with visits to the same hole within ${p.investigationRefractoryS} s merged into a single investigation.`,
    `Primary latency was the time to first come within ${p.reachedTargetRadiusCm} cm of the target hole. Escape was scored as a disappearance at the target hole persisting for at least ${p.escapeConfirmFrames} frames, corroborated by the last observed position. Errors were counted as distinct non-target holes investigated.`,
    `Frames in which the animal could not be localised and for which there was no evidence of hole entry were excluded rather than interpolated; the proportion of successfully localised frames is reported per trial. Trajectories were median filtered over ${p.smoothingWindowFrames} frames.`,
    `Search strategy was classified as spatial, serial or random using path directness, the sequence of hole visits and target quadrant occupancy, following the feature set of Illouz et al. (2016). Classifications were reviewed and could be overridden by an experimenter; the source of each label is recorded in the dataset.`,
    animals > 0
      ? `A total of ${trials.length} trials from ${animals} animals were analysed.`
      : '',
    `Check this paragraph against your protocol before use. It reports the settings this analysis used, not a substitute for describing your own experiment.`,
  ].filter(Boolean);

  return text.map((paragraph, i) => ({ section: i + 1, text: paragraph }));
}

/** Sheet 7: parameters. */
function parametersSheet(project: Project) {
  const rows: Record<string, unknown>[] = [
    { parameter: 'tool', value: TOOL },
    { parameter: 'tool_version', value: project.toolVersion },
    { parameter: 'exported_at', value: new Date().toISOString() },
    { parameter: 'error_counting_convention', value: 'distinct non-target holes investigated' },
    { parameter: 'gap_handling', value: 'skipped, not interpolated' },
    { parameter: 'movement_floor_cm_s', value: MOVEMENT_FLOOR_CM_S },
  ];
  for (const [k, v] of Object.entries(project.params)) rows.push({ parameter: k, value: v });
  return rows;
}

/**
 * Build and download the workbook.
 *
 * SheetJS is imported here rather than at the top of the file, so the ~430 KB
 * of spreadsheet machinery is fetched and parsed only when someone actually
 * exports. A user who opens the tool to read the example never pays for it, in
 * download or in memory.
 */
export async function downloadWorkbook(project: Project, filename: string): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const add = (name: string, rows: Record<string, unknown>[]) => {
    // An empty sheet with no header row is confusing to open. A placeholder row
    // says the sheet exists and why it is empty.
    const data = rows.length > 0 ? rows : [{ note: 'No rows. Score some trials first.' }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), name);
  };

  add('Measurements', measurementsSheet(project));
  add('Subjects', subjectsSheet(project));
  add('Events', eventsSheet(project));
  add('Summary', summarySheet(project));
  add('Data dictionary', dictionarySheet(project));
  add('Methods', methodsSheet(project));
  add('Parameters', parametersSheet(project));

  XLSX.writeFile(wb, filename);
}

/** Methods paragraph as plain text. */
export function methodsText(project: Project): string {
  return methodsSheet(project)
    .map((r) => r.text)
    .join('\n\n');
}
