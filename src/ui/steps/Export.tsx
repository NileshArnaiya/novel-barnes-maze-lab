import { downloadText, eventsCsv, parametersCsv, projectJson, trialSummaryCsv } from '../../io/csv';
import { downloadWorkbook, methodsText } from '../../io/workbook';
import { exportSleapCsv } from '../../io/poseImport';
import { useState } from 'react';
import type { CurveMeasure } from '../../core/aggregate';
import { LearningCurve } from '../components/LearningCurve';
import { useStore } from '../../state/store';

/**
 * Step 5: export.
 *
 * Four files rather than one. A single spreadsheet with everything in it forces
 * a scientist to unpick it before they can use it, and that unpicking is where
 * transcription errors come from. Each file has one shape and one job.
 */
export function Export() {
  const { project, activeVideo } = useStore();
  const [curveMeasure, setCurveMeasure] = useState<CurveMeasure>('primaryLatencyS');
  const scored = project.videos.filter((v) => v.summary).length;
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <h2>Export</h2>
      <p className="hint" style={{ marginTop: 6, marginBottom: 18 }}>
        {scored} of {project.videos.length} trials are scored. Every file records the tool
        version and the thresholds used, so a result stays reproducible after you have
        forgotten what you set.
      </p>

      <div className="panel">
        <h3>Learning curve</h3>
        <p className="hint" style={{ margin: '6px 0 12px' }}>
          The figure a Barnes maze paper is built around: a measure across training days, one
          line per cohort, mean and standard error. Built from the same per-trial numbers as the
          workbook, so the figure and the spreadsheet always agree.
        </p>
        <LearningCurve project={project} measure={curveMeasure} onMeasure={setCurveMeasure} />
      </div>

      <div className="panel">
        <h3>Analysis-ready workbook</h3>
        <p className="hint" style={{ margin: '6px 0 12px' }}>
          Seven sheets: measurements, subjects, events, group summary statistics, a data
          dictionary defining every column, a methods paragraph built from the settings you
          actually used, and the full parameter record. This is the file to hand to a
          collaborator, because it explains itself without you in the room.
        </p>
        <div className="row">
          <button
            className="primary"
            onClick={() => void downloadWorkbook(project, `barnes-dataset-${stamp}.xlsx`)}
          >
            Download workbook
          </button>
          <button
            onClick={() => downloadText(`barnes-methods-${stamp}.txt`, methodsText(project))}
          >
            Methods paragraph only
          </button>
        </div>
      </div>

      <div className="panel">
        <h3>Trial summary</h3>
        <p className="hint" style={{ margin: '6px 0 12px' }}>
          One row per trial. This is the file that goes into your statistics. Latency columns
          are paired with explicit reached and escaped flags so a blank cell can never be read
          as a zero.
        </p>
        <button onClick={() => downloadText(`barnes-trials-${stamp}.csv`, trialSummaryCsv(project))}>
          Download trial summary
        </button>
      </div>

      <div className="panel">
        <h3>Events</h3>
        <p className="hint" style={{ margin: '6px 0 12px' }}>
          One row per scored event, with frame numbers. This is how a disputed error count gets
          checked: the frame numbers here are the ones you can jump to in step 4.
        </p>
        <button onClick={() => downloadText(`barnes-events-${stamp}.csv`, eventsCsv(project))}>
          Download events
        </button>
      </div>

      <div className="panel">
        <h3>Parameters</h3>
        <p className="hint" style={{ margin: '6px 0 12px' }}>
          Every threshold, the tool version, and the counting conventions used. Keep this
          beside your data. It is what answers "why do these two cohorts disagree" later.
        </p>
        <button onClick={() => downloadText(`barnes-parameters-${stamp}.csv`, parametersCsv(project))}>
          Download parameters
        </button>
      </div>

      <div className="panel">
        <h3>Project file</h3>
        <p className="hint" style={{ margin: '6px 0 12px' }}>
          Reload this to pick up exactly where you left off, including hand corrections.
          Uncorrected tracks are left out because they can be recomputed; corrections cannot.
        </p>
        <button onClick={() => downloadText(`barnes-project-${stamp}.json`, projectJson(project))}>
          Download project
        </button>
      </div>

      <div className="panel">
        <h3>Corrected track, SLEAP format</h3>
        <p className="hint" style={{ margin: '6px 0 12px' }}>
          Corrections you made here are real work and should not be trapped in this tool. Send
          them back to your own pipeline.
        </p>
        <button
          disabled={!activeVideo?.track}
          onClick={() =>
            activeVideo?.track &&
            downloadText(`${activeVideo.animalId}-corrected.csv`, exportSleapCsv(activeVideo.track))
          }
        >
          Download corrected track
        </button>
      </div>
    </div>
  );
}
