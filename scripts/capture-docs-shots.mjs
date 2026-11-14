// Retakes the docs screenshots: headless Microsoft Edge over the DevTools Protocol at
// deviceScaleFactor 2, against the DEMO build only (never a real tenant -- see
// docs/img/README.md). Deliberately outside the build, like make-og-card.py.
//
//   VITE_STATIC_DEMO=1 npm run dev -w apps/web          # note the port it prints
//   node scripts/capture-docs-shots.mjs http://localhost:<port> docs/img <empty-profile-dir> [name,name]
//
// Do NOT add captureBeyondViewport to a clipped shot: it resizes the page for the
// capture, the layout crosses a breakpoint, and the rail remounts with its filters reset.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [, , BASE, OUT, PROFILE, ONLY] = process.argv;
const PORT = 9333;
const W = 1500,
  H = 940;
const edge = spawn(
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--hide-scrollbars",
    `--window-size=${W},${H}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try {
    target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
const js = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails)
    throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed: " + expression.slice(0, 80));
  return r.result?.result?.value;
};
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });

const HELPERS = `
window.$q = (sel) => document.querySelector(sel);
window.$text = (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.replace(/\\s+/g, " ").trim().includes(text));
window.$click = (sel, text) => { const e = text === undefined ? $q(sel) : $text(sel, text); if (!e) throw new Error("no element: " + sel + " / " + text); e.click(); return true; };
window.$group = (name) => { const l = [...document.querySelectorAll("aside label")].find((e) => e.textContent.includes(name)); if (!l) throw new Error("no group " + name); l.querySelector("input").click(); return true; };
window.$type = (el, value) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); return true; };
window.$select = (el, value) => { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(el, value); el.dispatchEvent(new Event("change", { bubbles: true })); return true; };
true`;

async function fresh(storage = {}) {
  await send("Page.navigate", { url: BASE });
  await sleep(1200);
  await js(
    `localStorage.clear(); ${Object.entries(storage)
      .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
      .join("")} true`
  );
  await send("Page.navigate", { url: BASE });
  await sleep(2500);
  await js(HELPERS);
}
async function shot(name, selector, pad = 0, maxHeight = Infinity) {
  await sleep(900);
  let clip;
  if (selector) {
    const r = await js(
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`
    );
    if (!r) throw new Error(`${name}: no element ${selector}`);
    clip = {
      x: Math.max(0, r.x - pad),
      y: Math.max(0, r.y - pad),
      width: r.width + pad * 2,
      height: Math.min(r.height + pad * 2, maxHeight),
      scale: 1,
    };
  }
  const res = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(res.result.data, "base64"));
  console.log("shot", name);
}
const CANVAS = ".react-flow";
const SIDEBAR = 'aside[aria-label="Simulated endpoint"]';
const RAIL_APPS = 'aside[aria-label="Apps"]';

const shots = {
  "01-simulator-overview": async () => {
    await fresh();
    await js(`$group("Windows - Corporate Devices")`);
    await js(`$click("aside label", "Autopilot device") || true`).catch(() => {});
    await sleep(1500);
    await shot("01-simulator-overview");
  },
  "02-entra-groups": async () => {
    await fresh();
    await js(`$group("Windows - Corporate Devices"); $group("Windows - Update Ring - Pilot")`);
    await sleep(800);
    await shot("02-entra-groups", SIDEBAR);
  },
  "03-autopilot-group-tag": async () => {
    await fresh();
    await js(
      `[...document.querySelectorAll("aside label")].find((e) => e.textContent.trim() === "Autopilot device").querySelector("input").click()`
    );
    await sleep(400);
    await js(`$type($q('aside input[placeholder^="Group Tag"]'), "KIOSK-MULTI")`);
    await sleep(1500);
    await shot("03-autopilot-group-tag");
  },
  "04-grouped-vs-detail": async () => {
    await fresh();
    await js(`$click("aside button", "macOS")`);
    await sleep(600);
    await js(`$group("macOS - Laptops")`);
    await sleep(800);
    await js(`$click("button", "Detail view")`);
    await sleep(2000);
    await shot("04-grouped-vs-detail", CANVAS);
  },
  "05-hide-group": async () => {
    await fresh();
    await js(`$group("Windows - Corporate Devices")`);
    await sleep(1200);
    await js(`document.querySelector('.react-flow__node[data-id="group:virtual-all-users"]').click()`);
    await sleep(1500);
    await shot("05-hide-group", CANVAS);
  },
  "06-policy-waitlist": async () => {
    await fresh();
    await js(`$group("Windows - Corporate Devices")`);
    await js(`$click("aside button", "Policy Waitlist")`);
    await sleep(500);
    await js(
      `(() => { const ls = [...document.querySelectorAll("aside label")].filter((l) => l.querySelector("input.accent-orange-400")); ls[0].querySelector("input").click(); ls[1].querySelector("input").click(); return ls.length; })()`
    );
    await sleep(1800);
    await shot("06-policy-waitlist");
  },
  "07-merged-baseline": async () => {
    await fresh();
    await js(`$group("Windows - Corporate Devices")`);
    await sleep(1200);
    await js(`$click("button", "Open ↗")`);
    await sleep(1500);
    await shot("07-merged-baseline");
  },
  "09-conflicts-overlaps": async () => {
    await fresh();
    await js(`$group("Windows - Corporate Devices")`);
    await sleep(1200);
    await js(`$click("button", "Open ↗")`);
    await sleep(1000);
    await js(`$type($q('[role="dialog"] input[placeholder^="Filter settings"]'), "Defender")`);
    await sleep(600);
    await js(`(() => { const b = $text('[role="dialog"] button', "overlap"); if (b) b.click(); return !!b; })()`).catch(
      () => {}
    );
    await sleep(1200);
    await shot("09-conflicts-overlaps", '[role="dialog"][aria-label="Merged baseline"]', 0, 660);
  },
  "10-autopilot-v1-v2": async () => {
    await fresh({ endpointSidebarCollapsed: "0" });
    await js(
      `[...document.querySelectorAll("aside label")].find((e) => e.textContent.trim() === "Autopilot device").querySelector("input").click()`
    );
    await sleep(1500);
    await js(`document.querySelector('button[title="Show deployment details"]').click()`);
    await sleep(1500);
    await shot("10-autopilot-v1-v2", CANVAS);
  },
  "11-platform-support": async () => {
    await fresh();
    await js(`$click("aside button", "macOS")`);
    await sleep(800);
    await js(`$group("macOS - Laptops")`);
    await sleep(1500);
    await shot("11-platform-support");
  },
  "18-apps-overview": async () => {
    await fresh({ simulatorRailTab: "apps" });
    await js(`$group("Windows - Corporate Devices")`);
    await sleep(1800);
    await shot("18-apps-overview");
  },
  "19-apps-same-product": async () => {
    await fresh({ simulatorRailTab: "apps" });
    await js(`$group("Windows - Corporate Devices")`);
    await sleep(1500);
    await js(`$click('aside[aria-label="Apps"] button', "opposing intents")`);
    await sleep(1000);
    await shot("19-apps-same-product", RAIL_APPS, 0, 470);
  },
  "20-apps-findings": async () => {
    await fresh({ simulatorRailTab: "apps" });
    await js(`$group("Windows - Corporate Devices")`);
    await sleep(1500);
    await js(`$click('aside[aria-label="Apps"] button', "LOB to convert")`);
    await sleep(1000);
    await shot("20-apps-findings", RAIL_APPS, 0, 440);
  },
};

let failed = 0;
for (const [name, run] of Object.entries(shots)) {
  if (ONLY && !ONLY.split(",").includes(name)) continue;
  try {
    await run();
  } catch (e) {
    failed++;
    console.log("FAILED", name, e.message);
  }
}
ws.close();
edge.kill();
process.exit(failed ? 1 : 0);
