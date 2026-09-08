# Export schema

## Workbook sheets

### Measurements
One row per trial. **This is the analysis unit, and a trial is not an animal.**

| Column | Type | Notes |
| --- | --- | --- |
| `animal_id` | string | Parsed from the filename, user-editable. Verify before analysis. |
| `cohort` | string | |
| `day` | int or blank | Training day. |
| `trial_type` | `acquisition` \| `probe` | Probe trials have no escape box. |
| `video_file`, `frame_rate_fps`, `video_duration_s` | | Provenance. |
| `reached_target` | bool | **Read before `primary_latency_s`.** |
| `primary_latency_s` | float or blank | Blank means never reached. Not zero. |
| `escaped` | bool | Always false on probe trials. |
| `total_latency_s` | float or blank | Blank means never escaped, or probe trial. |
| `primary_errors`, `total_errors` | int | Distinct non-target holes. |
| `path_length_cm` | float | Gaps skipped, not interpolated. Under-reports when tracking is poor. |
| `mean_speed_cm_s` | float | Speed while moving, excluding frames below 1 cm/s. |
| `target_quadrant_time_s` | float | Quadrant defined relative to the target hole. |
| `search_strategy` | `spatial` \| `serial` \| `random` \| `undetermined` | |
| `strategy_confidence` | float 0-1 | `random` is capped at 0.5, being a residual category. |
| `strategy_source` | `auto` \| `human` | Whether a person overrode the label. |
| `path_directness` | float 0-1 | 1 is a beeline. Measured to first target arrival only. |
| `longest_serial_run` | int | Longest run of ring-adjacent holes visited consecutively. |
| `thigmotaxis_fraction` | float 0-1 | Anxiety readout that mimics poor memory. |
| `tracked_fraction` | float 0-1 | Frames with a known position. In-hole counts as known. |
| `human_edited_frames` | int | Manual corrections. |
| `qc_flag` | string or blank | Set when the tool wants a human to look. |

### Subjects
One row per animal: `animal_id`, `cohort`, `sex`, `genotype`, `treatment`, `n_trials`,
`days_run`. Sex, genotype and treatment are blank for the user to fill in, because they are
not derivable from a video. **Join group assignment from here rather than assuming it is on
the trial rows.**

### Events
One row per scored behavioural event, with `start_frame` / `end_frame`. This is how a
disputed error count gets checked: the frame numbers are the ones the tool will jump to.

`event` is `investigation`, `reached-target` or `escape`.

### Summary
Group means with `sd`, `sem`, `n`, and `n_censored` per cohort, day and measure.
Censored trials are counted separately, never averaged in. Strategy appears as counts
because it is categorical.

### Data dictionary
Every column defined with units and the threshold that produced it, for this specific file.
**Read this first.**

### Methods
A paste-able methods paragraph generated from the parameters actually used.

### Parameters
Tool version, export time, every threshold, and the counting conventions.

## CSV exports

`barnes-trials-*.csv` matches Measurements. `barnes-events-*.csv` matches Events.
`barnes-parameters-*.csv` matches Parameters.

## Project file

`barnes-project-*.json` reloads the tool exactly where it was left, including hand
corrections. Shape:

```
{
  schemaVersion: 1,
  toolVersion: string,
  params: ScoringParams,
  videos: [{
    id, fileName, animalId, cohort, day, trialType, fps, width, height,
    map: { platformCenter, platformRadiusPx, platformDiameterCm, holes[], origin },
    track: TrackPoint[] | null,   // null when nothing was hand-corrected
    events: MazeEvent[],
    summary: TrialSummary,
    qcFlag: string | null
  }]
}
```

`TrackPoint.state` is the important field:

| State | Meaning |
| --- | --- |
| `tracked` | Position observed. `body` is valid. |
| `in-target-hole` | Disappeared at the escape hole. This is the escape. |
| `in-other-hole` | Disappeared at a non-target hole. |
| `lost` | Disappeared with no explanation. `body` is null. |

The first three are all *known* positions for the purpose of `tracked_fraction`. Only
`lost` counts against it. Uncorrected tracks are omitted from the project file because they
can be recomputed from the video; corrected tracks are always kept, because human work
cannot be.
