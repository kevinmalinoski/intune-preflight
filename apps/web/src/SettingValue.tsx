import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A value too big for the row it sits in: more than one line, or long enough to
 * push everything after it off the screen. A platform script is both.
 */
function isLongValue(value: string): boolean {
  return value.includes("\n") || value.length > 240;
}

/**
 * A setting's value. Short ones are text, as they always were. A long one --
 * in practice a script -- is a button that opens it in a viewer, because a
 * table cell showed the first forty characters of it and the list showed all
 * five thousand, and neither is how anyone reads a script.
 */
export function SettingValue({ value, title, className }: { value: string; title?: string; className?: string }) {
  const [open, setOpen] = useState(false);

  if (!isLongValue(value)) {
    return (
      <span title={value} className={className}>
        {value}
      </span>
    );
  }

  const lines = value.split("\n").length;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Rows that expand on click must not also expand for this.
          e.stopPropagation();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        className="inline-flex max-w-full items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-[11px] font-medium text-sky-300 transition-colors hover:border-sky-400/50 hover:bg-ink-700"
      >
        <span aria-hidden>{"</>"}</span>
        <span className="truncate">{lines > 1 ? `View · ${lines} lines` : "View full value"}</span>
      </button>
      {open && <ValueViewer value={value} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function ValueViewer({ value, title, onClose }: { value: string; title?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Capture phase, and stopped there: Escape closes this viewer and not the
    // baseline panel underneath it, which listens for the same key.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard access (an insecure origin, a denied permission): the text
      // is on screen and selectable, which is the fallback.
    }
  };

  // A portal, because this is opened from inside table cells and scrolling
  // panels, both of which would clip it.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 sm:p-6"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Full value"}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
          <div className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">{title ?? "Full value"}</div>
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-ink-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-ink-800"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-ink-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-ink-800"
          >
            Close
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-3 font-mono text-[12px] leading-relaxed text-slate-200">
          {value}
        </pre>
      </div>
    </div>,
    document.body
  );
}
