import { Component, type ComponentChildren } from "preact";

interface State {
  error: Error | null;
}

/**
 * Last line of defence (M8 error states): a screen that throws while rendering, or a lazy screen
 * whose code cannot load (offline before it was cached), shows a recoverable message instead of
 * a blank page. Games in progress are saved after every turn, so "Back to title" loses nothing.
 */
export class ErrorBoundary extends Component<
  { children: ComponentChildren; onReset(): void },
  State
> {
  override state: State = { error: null };

  static override getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const offline =
      /dynamically imported module|Failed to fetch|Importing a module script failed|ChunkLoad/i.test(
        error.message,
      );
    return (
      <main class="panel-screen error-screen" role="alert">
        <h2>{offline ? "You're offline" : "Something went wrong"}</h2>
        <p class="hint">
          {offline
            ? "This screen hasn't been downloaded yet. Reconnect and try again; skirmishes you've already started keep working offline."
            : "The game hit an unexpected error. Your progress and any saved game are safe."}
        </p>
        <details class="muted">
          <summary>Details</summary>
          <code>{error.message}</code>
        </details>
        <div class="button-row">
          <button
            class="btn btn-primary"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset();
            }}
          >
            Back to title
          </button>
          <button class="btn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}
