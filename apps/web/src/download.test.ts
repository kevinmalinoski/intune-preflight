import { describe, expect, it } from "vitest";
import { prefersShareSheet } from "./download.ts";

/**
 * The share sheet is for iOS and iPadOS. Everywhere else an export must
 * download, and both formats must behave the same way on the same machine --
 * the bug this pins is a CSV opening the Windows share dialog while the JSON
 * beside it downloaded, because the branch asked whether sharing was POSSIBLE
 * rather than whether downloading was broken.
 */
describe("prefersShareSheet", () => {
  const nav = (userAgent: string, platform: string, maxTouchPoints = 0) => ({
    userAgent,
    platform,
    maxTouchPoints,
  });

  it("is true on iPhone and iPad", () => {
    expect(prefersShareSheet(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "iPhone"))).toBe(true);
    expect(prefersShareSheet(nav("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "iPad"))).toBe(true);
  });

  it("is true on an iPadOS device masquerading as a Mac", () => {
    // Safari on iPadOS reports MacIntel and a desktop UA; the touch points are
    // the only thing that distinguishes it from a real Mac.
    expect(prefersShareSheet(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5))).toBe(true);
  });

  it("is false on Windows, where sharing a file is possible but wrong", () => {
    expect(prefersShareSheet(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32"))).toBe(false);
    // A Windows touchscreen is still a desktop: touch points alone must not flip it.
    expect(prefersShareSheet(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 10))).toBe(false);
  });

  it("is false on a desktop Mac", () => {
    expect(prefersShareSheet(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0))).toBe(false);
  });

  it("does not throw on a navigator that reports nothing", () => {
    expect(prefersShareSheet({})).toBe(false);
  });
});
