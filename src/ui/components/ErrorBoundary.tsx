import { Component, type ReactNode } from 'react';

/**
 * A crash in one panel should not take the whole tool down.
 *
 * Without this, a malformed imported file or an unexpected null anywhere in the
 * render tree gives the user a white screen and no way back, taking their
 * unexported work with it. The boundary keeps the app alive and, importantly,
 * tells them their work is still saved locally.
 */
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="main narrow">
        <div className="panel">
          <h2>Something in the interface broke</h2>
          <p className="hint" style={{ margin: '8px 0 14px' }}>
            Your work is still saved in this browser. Reload the page to get back to it. If this
            keeps happening, the message below is the useful part of a bug report.
          </p>
          <pre
            style={{
              background: 'var(--paper-sunk)',
              padding: 12,
              borderRadius: 8,
              overflowX: 'auto',
              fontSize: 12,
            }}
          >
            {this.state.error.message}
          </pre>
          <button className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
