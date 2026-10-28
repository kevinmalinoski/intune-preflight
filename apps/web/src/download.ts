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
export type Download =
  | { kind: "url"; url: string }
  | { kind: "text"; text: string; mime: string }
  /**
   * Bytes rather than a string: the .xlsx export is a ZIP, and putting it
   * through the `text` variant would mean a `charset=utf-8` on a binary blob
   * and a string round-trip that mangles every byte above 0x7f. The engine
   * hands over a `Uint8Array`; `ArrayBuffer` is accepted too so a caller that
   * has one does not have to wrap it.
   */
  | { kind: "bytes"; bytes: Uint8Array | ArrayBuffer; mime: string };

/**
 * Saves an export under `filename`.
 *
 * One path for every platform: a Blob on an anchor carrying `download`. That
 * works on iOS and iPadOS too -- Safari shows its own download prompt and the
 * file lands in Files > Downloads, verified in the simulator. The original bug
 * was specific to `data:` URLs, which Safari will not save; a Blob was the
 * whole fix.
 *
 * v2.3.0 to v2.3.2 also routed iOS through `navigator.share({ files })`, on the
 * assumption that a download would not work there. It does, and the share sheet
 * was worse: it asks the user to choose a destination rather than using
 * Downloads, and it gated on a capability that is also true on Windows, which
 * is how a desktop CSV export started opening the Windows share dialog. Three
 * releases of churn for a branch that was never needed. Do not reintroduce it
 * without first checking that a plain download actually fails on the device in
 * question.
 *
 * Still call this straight from a click handler with nothing awaited first: the
 * API's export helpers are synchronous for the same reason, and a download
 * started a task later is treated as non-user-initiated.
 */
export function saveDownload(download: Download, filename: string): void {
  if (download.kind === "url") {
    clickAnchor(download.url, filename);
    return;
  }
  if (download.kind === "bytes") {
    // No charset: it would be a lie on a ZIP, and some readers take it as one.
    //
    // The cast closes a gap in the DOM types rather than papering over
    // anything: since TypeScript 5.7 a bare `Uint8Array` may be backed by a
    // `SharedArrayBuffer`, which `BlobPart` does not accept, and there is no
    // way to say "not shared" that also holds in the TypeScript this package
    // declares as its minimum. These bytes come from the engine's own
    // allocation, so they are never shared.
    saveBlob(new Blob([download.bytes as BlobPart], { type: download.mime }), filename);
    return;
  }
  saveBlob(new Blob([download.text], { type: `${download.mime};charset=utf-8` }), filename);
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
