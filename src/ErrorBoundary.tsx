import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Catches an error thrown while drawing, so one bug never leaves the user with an empty window: the message is
 * shown with a button that tries again (the project in memory is kept).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ISL PCB: drawing failed', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ padding: 24, maxWidth: 640, margin: '10vh auto', color: 'var(--text)', fontFamily: 'inherit' }}>
        <h2 style={{ color: 'var(--danger)' }}>Something went wrong / Bir hata oluştu</h2>
        <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--panel-2)', padding: 12, borderRadius: 8 }}>{this.state.error.message}</pre>
        <button onClick={() => this.setState({ error: null })}>Try again / Yeniden dene</button>{' '}
        <button onClick={() => window.location.reload()}>Reload / Yeniden yükle</button>
      </div>
    );
  }
}
