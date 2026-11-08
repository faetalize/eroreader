import type { Browser } from "webextension-polyfill";

// Firefox exposes the promise-based `browser` namespace. Chromium only has `chrome`, whose
// MV3 APIs also return promises for everything this extension uses, so no polyfill is needed.
export const ext: Browser = (globalThis as { browser?: Browser }).browser ??
  (globalThis as unknown as { chrome: Browser }).chrome;
