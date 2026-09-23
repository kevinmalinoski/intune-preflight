import { Component, type ErrorInfo, type ReactNode } from "react";

const REPO_ISSUES_URL = "https://github.com/kevinmalinoski/intune-preflight/issues";

/**
 * Catches a render-time throw so a single bad component can't blank the page.
 *
 * Without one, React 18 unmounts the entire tree on an uncaught render error
 * and the user is left staring at a white screen with no way to tell whether
 * the app broke or the tenant load is just slow. That matters most where it is
 * least debuggable: the public demo, and a colleague's browser.
 *
 * It deliberately shows the real error text rather than a friendly nothing --
 * the audience is an Intune admin who can paste it into a bug report.
 */
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack in the console; the panel below stays readable.
    console.error("Intune Preflight crashed while rendering:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center bg-ink-950 p-8">
        <div className="max-w-xl rounded-lg border border-red-500/30 bg-red-500/5 p-5 text-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold text-red-300">
            <span aria-hidden>⚠️</span> Something broke while rendering
          </div>
          <p className="mb-3 text-slate-300">
            This is a bug in Intune Preflight, not a problem with your tenant — nothing was written to Intune (the tool
            is read-only). Reloading usually clears it.
          </p>
          <pre className="mb-3 max-h-40 overflow-auto rounded border border-ink-700 bg-ink-900 p-2 text-[11px] leading-relaxed text-red-200">
            {error.message}
          </pre>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-ink-800"
            >
              Reload
            </button>
            <a
              href={REPO_ISSUES_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              Report it ↗
            </a>
          </div>
        </div>
      </div>
    );
  }
}
