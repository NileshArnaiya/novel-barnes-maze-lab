import { useMemo, useState } from 'react';
import { hasSeenWalkthrough } from '../io/db';
import { useStore } from '../state/store';
import { CohortRail } from './components/CohortRail';
import { ShortcutsButton, useKeyboardShortcuts } from './components/Shortcuts';
import { StatusBanner } from './components/StatusBanner';
import { Walkthrough } from './components/Walkthrough';
import { Export } from './steps/Export';
import { Load } from './steps/Load';
import { Maze } from './steps/Maze';
import { Review } from './steps/Review';
import { Track } from './steps/Track';

/**
 * The shell.
 *
 * A guided wizard, because the person using this may run it four times a year
 * and will not remember the workflow in between. Five steps, one screen each,
 * so there is never a question about what to do next.
 *
 * Two deliberate departures from a strict wizard, both because the alternative
 * would make the real job harder:
 *
 *   1. Steps are always re-enterable. Nothing is locked behind "complete step
 *      3 first". Scoring is a loop, not a line, and a user who wants to change
 *      the maze after seeing the numbers is doing the right thing.
 *   2. Step 4 opens into a full workspace rather than a single-task screen,
 *      because reviewing is where the time goes and it needs everything visible
 *      at once.
 *
 * The cohort rail stays present throughout, so the unit of work reads as "sixty
 * trials" rather than "one video, sixty times".
 */

const STEPS = [
  { n: 1, label: 'Load' },
  { n: 2, label: 'Maze' },
  { n: 3, label: 'Track' },
  { n: 4, label: 'Review' },
  { n: 5, label: 'Export' },
] as const;

export function App() {
  const { project, activeVideo, activeVideoId, setActiveVideo, clearExamples, storageWarning, loading } =
    useStore();
  /**
   * Always start at step 1.
   *
   * Restoring the last step sounds helpful and is not: someone returning after
   * four months lands on a screen of numbers with no idea how they got there,
   * and a first-time visitor lands on results for data they never loaded. Step
   * 1 is the only screen that explains itself, and the example trials are
   * already scored and one click away in the rail.
   */
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [showWalkthrough, setShowWalkthrough] = useState(() => !hasSeenWalkthrough());

  // Number keys jump between steps. Kept here rather than in each step so the
  // shortcut works from anywhere, and guarded inside the hook so typing a
  // platform diameter does not navigate away mid-number.
  useKeyboardShortcuts(
    useMemo(
      () => ({
        '1': () => setStep(1),
        '2': () => setStep(2),
        '3': () => setStep(3),
        '4': () => setStep(4),
        '5': () => setStep(5),
      }),
      [],
    ),
  );

  if (loading) {
    return (
      <div className="main narrow">
        <p className="hint">Loading your last session.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <a className="skip-link" href="#workspace">
        Skip to the workspace
      </a>
      <header className="topbar">
        <div>
          <h1>Barnes maze scorer</h1>
          <div className="subtitle">Runs in your browser. Nothing is uploaded.</div>
        </div>
        <span className="spacer" />
        <nav className="ribbon" aria-label="Workflow steps">
          {STEPS.map((s) => (
            <button
              key={s.n}
              className={`step-chip${step === s.n ? ' current' : ''}${
                activeVideo && activeVideo.step > s.n ? ' done' : ''
              }`}
              onClick={() => setStep(s.n)}
              aria-current={step === s.n ? 'step' : undefined}
            >
              <span className="num">{s.n}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <button className="ghost" onClick={() => setShowWalkthrough(true)}>
          How this works
        </button>
      </header>

      {storageWarning ? <div className="notice">{storageWarning}</div> : null}

      <div className="body">
        <aside className="rail" aria-label="Trials">
          <CohortRail
            videos={project.videos}
            activeId={activeVideoId}
            onClearExamples={clearExamples}
            onSelect={(id) => {
              setActiveVideo(id);
              // Land on Review when the trial already has numbers to look at.
              // Sending someone back to step 1 for a scored trial would be
              // busywork.
              const v = project.videos.find((x) => x.id === id);
              if (v?.summary) setStep(4);
            }}
          />
        </aside>

        <main id="workspace" className={`main${step === 4 ? '' : ' narrow'}`}>
          {/* State of the current trial, above whatever step is open, so the
              user always knows where they stand rather than inferring it. */}
          {step !== 1 ? <StatusBanner video={activeVideo} step={step} /> : null}

          {step === 1 ? <Load onLoaded={() => setStep(2)} /> : null}

          {step !== 1 && !activeVideo ? (
            <div className="panel">
              <h2>No trial selected</h2>
              <p className="hint" style={{ marginTop: 8 }}>
                Pick one from the list, or load some data in step 1.
              </p>
            </div>
          ) : null}

          {step === 2 && activeVideo ? <Maze video={activeVideo} onDone={() => setStep(3)} /> : null}
          {step === 3 && activeVideo ? <Track video={activeVideo} onDone={() => setStep(4)} /> : null}
          {step === 4 && activeVideo ? <Review video={activeVideo} /> : null}
          {step === 5 ? <Export /> : null}
        </main>
      </div>

      {showWalkthrough ? <Walkthrough onClose={() => setShowWalkthrough(false)} /> : null}
      <ShortcutsButton />
    </div>
  );
}
