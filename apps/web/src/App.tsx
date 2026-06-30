import { EndpointSimulator } from "./EndpointSimulator.tsx";

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-5 py-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Intune Policy Baseline</h1>
          <p className="text-xs text-slate-400">
            An intelligent, no-Policy-Sets view of what's actually assigned to each device group.
          </p>
        </div>
      </header>

      <EndpointSimulator />
    </div>
  );
}
