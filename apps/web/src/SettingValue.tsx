import { useEffect, useRef, useState } from "react";
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
  const trigger = useRef<HTMLButtonElement>(null);

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
        ref={trigger}
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
      {open && (
        <ValueViewer
          value={value}
          title={title}
          onClose={() => {
            setOpen(false);
            // Back to where the keyboard was, not the top of the page.
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}

function ValueViewer({ value, title, onClose }: { value: string; title?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Opened from inside the baseline panel, which keeps focus to itself. Without
  // taking focus and holding it here, Tab went round the panel underneath and a
  // keyboard could reach neither Copy nor Close.
  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    // Capture phase, and stopped there: Escape closes this viewer and not the
    // baseline panel underneath it, which listens for the same key.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const stops = [...(dialog.current?.querySelectorAll<HTMLElement>("button, pre") ?? [])];
        if (stops.length === 0) return;
        const at = stops.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === stops.length - 1 ? 0 : at + 1;
        e.preventDefault();
        e.stopPropagation();
        stops[next].focus();
        return;
      }
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
        ref={dialog}
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
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-ink-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-ink-800"
          >
            Close
          </button>
        </div>
        <pre
          tabIndex={0}
          className="min-h-0 flex-1 overflow-auto whitespace-pre p-3 font-mono text-[12px] leading-relaxed text-slate-200"
        >
          {value}
        </pre>
      </div>
    </div>,
    document.body
  );
}
