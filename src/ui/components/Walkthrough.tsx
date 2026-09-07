import { useState } from 'react';
import { markWalkthroughSeen } from '../../io/db';

/**
 * The first-run walkthrough.
 *
 * Shown once per browser, replayable from the header. It points at software
 * that is already loaded and already working, rather than describing what the
 * tool would do if you gave it data. A first-time visitor should understand
 * what this is before they decide whether to spend an afternoon on it.
 */

const STEPS = [
  {
    title: 'This scores Barnes maze trials',
    body: 'Drop in tracked trials, define the maze once, and get latencies, error counts and search strategies you can defend. Everything runs in this tab. Nothing is uploaded.',
  },
  {
    title: 'Three example trials are already loaded',
    body: 'They are generated, not recorded, and labelled as such wherever they appear. One of them contains a deliberate tracking failure, because how a tool behaves when it fails matters more than how it behaves when it works.',
  },
  {
    title: 'Every number is checkable',
    body: 'Click any measure to jump to the frame it came from. The path is drawn with a visible break wherever the animal was not seen, so you can tell measured from assumed at a glance.',
  },
  {
    title: 'The thresholds are yours',
    body: 'What counts as investigating a hole is a judgement call, not a fact. Every threshold is on screen, drag it and watch the numbers move, and all of them are written into your exports.',
  },
  {
    title: 'Already using SLEAP or DeepLabCut?',
    body: 'Bring those tracks straight in. This tool does the scoring layer your pipeline is missing, and corrected tracks export back out.',
  },
];

export function Walkthrough({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;

  const finish = () => {
    markWalkthroughSeen();
    onClose();
  };

  return (
    <div className="walkthrough-backdrop" role="dialog" aria-modal="true" aria-label="Introduction">
      <div className="walkthrough">
        <h2>{step.title}</h2>
        <p style={{ marginTop: 10, color: 'var(--ink-soft)' }}>{step.body}</p>
        <div className="dots">
          {STEPS.map((_, n) => (
            <span key={n} className={`dot${n === i ? ' on' : ''}`} />
          ))}
        </div>
        <div className="row">
          <button className="ghost" onClick={finish}>
            Skip
          </button>
          <span className="grow" />
          {i > 0 ? <button onClick={() => setI(i - 1)}>Back</button> : null}
          <button className="primary" onClick={() => (last ? finish() : setI(i + 1))}>
            {last ? 'Start' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
