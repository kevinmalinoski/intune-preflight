/**
 * Saving an export to the admin's machine.
 *
 * The three builds produce an export in two genuinely different ways, and this
 * is where that difference stops: the server build points at a real
 * `/api/.../export` endpoint and lets its `Content-Disposition` do the saving,
 * while the demo and live builds run the engine in the browser and so already
 * hold the bytes.
 *
 * Both used to be a single `string` href on an anchor carrying a `download`
 * attribute -- a real path for the server build, a `data:` URL for the other
 * two. That does not work in Safari, which does not honour `download` on a
 * `data:` URL: the click degrades into a top-level navigation to a `data:` URL,
 * which Safari then blocks outright. On iPadOS that reads as a download prompt
 * followed by nothing happening at all. Telling the two cases apart in the type
 * is what lets the browser-side one go through a Blob instead.
 *
 * The second reason not to be a URL: an href is read during render, so the demo
 * build re-ran `computeSimulation` and re-serialised the whole result on every
 * render of the panel, for both buttons, before anyone had clicked anything. A
 * descriptor is built in the click handler instead.
 */
export type Download = { kind: "url"; url: string } | { kind: "text"; text: string; mime: string };

/**
 * Saves an export under `filename`.
 *
 * Call this straight from a click handler and do nothing asynchronous first:
 * iOS only allows the share sheet below to open inside the click's own task,
 * and rejects it as non-user-initiated otherwise. That constraint is also why
 * the API's export helpers stay synchronous.
 */
export function saveDownload(download: Download, filename: string): void {
  if (download.kind === "url") {
    clickAnchor(download.url, filename);
    return;
  }

  const blob = new Blob([download.text], { type: `${download.mime};charset=utf-8` });

  // iPadOS has no filesystem to speak of, and "Save to Files" from the share
  // sheet is what a tablet user is actually reaching for. Feature-detected, so
  // desktop browsers -- where sharing a file is the wrong gesture entirely --
  // fall straight through to the anchor below.
  const file = asFile(blob, filename, download.mime);
  if (file && canShareFile(file)) {
    // Not awaited, on purpose. Awaiting would hand the rest of this function to
    // a later task, and a cancelled share rejects with AbortError -- so an
    // awaited fallback would download the file the admin just declined to save.
    void navigator.share({ files: [file] }).catch((err: Error) => {
      if (err.name !== "AbortError") saveBlob(blob, filename);
    });
    return;
  }

  saveBlob(blob, filename);
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  clickAnchor(url, filename);
  // Safari starts the save on a later turn, so revoking in this one cancels it
  // before it begins. A minute is far longer than any save needs and still
  // bounds how long the blob stays pinned in memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function clickAnchor(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  // Firefox only dispatches the click on an anchor that is in the document.
  document.body.append(a);
  a.click();
  a.remove();
}

function asFile(blob: Blob, filename: string, mime: string): File | null {
  try {
    return new File([blob], filename, { type: mime });
  } catch {
    return null;
  }
}

function canShareFile(file: File): boolean {
  try {
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    // Some browsers throw rather than answering false for a files payload.
    return false;
  }
}
