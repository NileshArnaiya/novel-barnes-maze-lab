import { useEffect, useState } from 'react';

/**
 * Keyboard shortcuts and the help affordance that reveals them.
 *
 * Two reasons this exists beyond ticking an accessibility box.
 *
 * First, the brief's minimum is that nothing essential is reachable only by
 * hover or drag. Frame stepping and hole selection were both mouse-first, which
 * fails that outright for anyone who cannot use a pointer precisely, and frame
 * stepping is the single most repeated action in the whole tool.
 *
 * Second, this is a tool someone may use four times a year. A discoverable list
 * of what the keyboard does is worth more here than in software people live in
 * daily, because there is no muscle memory to fall back on.
 */

export interface Shortcut {
  keys: string;
  description: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: '←  →', description: 'Step one frame back or forward' },
  { keys: 'Shift + ←  →', description: 'Step ten frames' },
  { keys: 'Home / End', description: 'Jump to the first or last frame' },
  { keys: 'G', description: 'Jump to the next gap in tracking' },
  { keys: 'X', description: 'Mark the current frame as not tracked' },
  { keys: '1 – 5', description: 'Go to that step of the workflow' },
  { keys: '?', description: 'Show this list' },
  { keys: 'Esc', description: 'Close this list' },
];

/**
 * Register a keyboard handler that ignores keystrokes aimed at form controls.
 *
 * Without the guard, typing a platform diameter of 15 would jump the user to
 * step 1 and step 5 on the way. Shortcuts that fire while someone is typing are
 * worse than no shortcuts.
 */
export function useKeyboardShortcuts(handlers: Record<string, () => void>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      // Leave browser and screen-reader chords alone.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.shiftKey && e.key.length === 1 ? `Shift+${e.key}` : e.key;
      const handler = handlers[key] ?? handlers[e.key];
      if (handler) {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}

export function ShortcutsButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '?') setOpen(true);
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        className="help-fab"
        onClick={() => setOpen(true)}
        aria-label="Keyboard shortcuts and accessibility help"
        aria-haspopup="dialog"
        title="Keyboard shortcuts (press ?)"
      >
        ?
      </button>

      {open ? (
        <div
          className="walkthrough-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          onClick={() => setOpen(false)}
        >
          <div className="walkthrough" onClick={(e) => e.stopPropagation()}>
            <h2>Keyboard shortcuts</h2>
            <p className="hint" style={{ marginTop: 8 }}>
              Everything in this tool can be done from the keyboard. Frame stepping and marking a
              bad frame are the two you will use most.
            </p>

            <table className="data" style={{ marginTop: 16 }}>
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.keys}>
                    <td style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                      {s.keys}
                    </td>
                    <td>{s.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 style={{ marginTop: 22 }}>Accessibility</h3>
            <ul className="reason" style={{ marginTop: 8 }}>
              <li>Tab reaches every control, and focus is always visible.</li>
              <li>
                Nothing is signalled by colour alone. Trial status carries a text label, the escape
                hole is filled as well as coloured, and a stretch where the animal was not seen is a
                visible break in the path rather than a different shade.
              </li>
              <li>The layout reflows at 200% browser zoom; the trial list moves above the workspace.</li>
              <li>Animation is disabled when your system asks for reduced motion.</li>
              <li>The timeline is a slider: focus it and use the arrow keys.</li>
            </ul>

            <div className="row" style={{ marginTop: 20 }}>
              <span className="grow" />
              <button className="primary" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
