import type { Platform } from "@intune-preflight/shared";

// `short` is what fits four-across in the sidebar; "iOS / iPadOS" does not.
export const PLATFORM_OPTIONS: { value: Platform; label: string; short: string }[] = [
  { value: "windows", label: "Windows", short: "Windows" },
  { value: "macos", label: "macOS", short: "macOS" },
  { value: "ios", label: "iOS / iPadOS", short: "iOS" },
  { value: "android", label: "Android", short: "Android" },
];
