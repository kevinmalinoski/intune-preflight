import { type MouseEvent as ReactMouseEvent, useState } from "react";
import { msLearnCspUrl, splitCspRef } from "./cspDocs.ts";

/**
 * A CSP reference, rendered in full: the value WRAPS instead of truncating,
 * because its full path is the entire point of showing it. Boilerplate prefix
 * dimmed, meaningful tail linked to its Microsoft Learn CSP reference when one
 * exists, with a copy button. stopPropagation everywhere -- these live inside
 * clickable rows in both presentations.
 */
export function CspRef({ refValue, docUrl }: { refValue: string; docUrl?: string }) {
  const [copied, setCopied] = useState(false);
  const { prefix, tail } = splitCspRef(refValue);
  // Prefer an explicit documentation URL (legacy intents carry one) over the
  // best-effort link derived from the CSP ref.
  const url = docUrl ?? msLearnCspUrl(refValue);

  const copy = (e: ReactMouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(refValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <span className="break-all font-mono text-[11px] leading-relaxed">
      {prefix && <span className="text-slate-600">{prefix}</span>}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Open this setting's CSP reference on Microsoft Learn"
          className="text-sky-400/90 decoration-sky-400/40 hover:text-sky-300 hover:underline"
        >
          {tail}
          <span className="ml-0.5 text-[9px] opacity-70" aria-hidden>
            ↗
          </span>
        </a>
      ) : (
        <span className="text-slate-400">{tail}</span>
      )}
      <button
        onClick={copy}
        title="Copy the full path"
        className={`ml-1 rounded px-1 align-middle text-[10px] ${
          copied ? "text-emerald-400" : "text-slate-600 hover:bg-ink-800 hover:text-slate-300"
        }`}
      >
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}
