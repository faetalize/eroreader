// Background entry point. It runs as a Firefox event page or a Chromium service worker, so it
// keeps no state in globals: everything lives in storage or IndexedDB.
import { ext } from "../shared/browser";
import { QUOTA_WARNING_BYTES, totalBytes } from "../shared/history";
import type { AppFocusMessage, AppTab } from "../shared/messages";
import { loadSettings } from "../shared/settings";
import { fetchCover, shrinkCover } from "./cover";
import { computeStats, putCover, recordVisit } from "./historyStore";
import { getManyProgress, getProgress, putProgress } from "./progressStore";
import { createListener, type Handlers } from "./router";
import { database } from "./schema";
import { recentSearches, recordSearch } from "./searchStore";
import { finishInSession, memoryArea, recentLines, saveRecentLines, type SessionArea } from "./session";

const sessionArea: SessionArea = (ext.storage.session as SessionArea | undefined) ?? memoryArea();

// The warning badge on the toolbar icon, past the storage mark.
async function updateBadge(): Promise<void> {
  const stats = await computeStats(await database());
  const over = totalBytes(stats) > QUOTA_WARNING_BYTES;
  await ext.action.setBadgeText({ text: over ? "!" : "" });
  if (over) await ext.action.setBadgeBackgroundColor({ color: "#e22266" });
  await ext.action.setTitle({ title: over ? `eroreader: history uses ${Math.round(totalBytes(stats) / 2 ** 20)} MB` : "eroreader" });
}

async function captureCover(gid: number, url: string): Promise<void> {
  const blob = await shrinkCover(await fetchCover(url));
  await putCover(await database(), gid, blob, Date.now());
}

const handlers: Handlers = {
  ping: () => ({ ok: true }),
  progressGet: async ({ gid }) => getProgress(await database(), gid),
  progressPut: async ({ record }) => {
    await putProgress(await database(), record);
    return null;
  },
  progressGetMany: async ({ gids }) => getManyProgress(await database(), Array.isArray(gids) ? gids.filter(Number.isInteger).slice(0, 500) : []),
  searchRecord: async ({ search }) => {
    await recordSearch(await database(), search, Date.now());
    return null;
  },
  searchRecent: async ({ host, limit }) => recentSearches(await database(), String(host), Math.min(200, Math.max(1, Number(limit) || 20))),
  historyVisit: async ({ visit }) => {
    if ((await loadSettings()).recordingPaused) return null;
    const { hasCover } = await recordVisit(await database(), visit, Date.now());
    // The cover only on the first visit: it's kept even if the gallery goes away later.
    if (!hasCover && visit.coverUrl) await captureCover(visit.gid, visit.coverUrl).catch(() => {});
    await updateBadge().catch(() => {});
    return null;
  },
  storageChanged: async () => {
    await updateBadge();
    return null;
  },
  openSettings: async () => {
    await openApp("settings", "settings");
    return null;
  },
  sessionFinish: ({ gid }) => finishInSession(sessionArea, gid),
  sessionRecent: () => recentLines(sessionArea),
  sessionSaveRecent: async ({ recent }) => {
    await saveRecentLines(sessionArea, recent);
    return null;
  },
};

ext.runtime.onMessage.addListener(createListener(handlers) as Parameters<typeof ext.runtime.onMessage.addListener>[0]);

// Brings the history and settings page's tab forward, switched to `section` if given, or opens
// the page on `fallback`. An open page answers for itself with its tab: no "tabs" permission
// is needed to find it, and a tab that has moved on to another site doesn't answer.
async function openApp(section: AppFocusMessage["section"], fallback: "history" | "settings"): Promise<void> {
  const tab = (await ext.runtime.sendMessage({ type: "appFocus", section } satisfies AppFocusMessage).catch(() => null)) as AppTab | null | undefined;
  if (tab) {
    try {
      await ext.tabs.update(tab.tabId, { active: true });
      await ext.windows.update(tab.windowId, { focused: true });
      return;
    } catch {
      // closed in the meantime
    }
  }
  await ext.tabs.create({ url: ext.runtime.getURL(`${section ?? fallback}.html`) });
}

// The toolbar icon opens the history, reusing the page's tab as it is when one is open.
ext.action.onClicked.addListener(() => void openApp(null, "history"));

// The badge is cleared when the browser restarts; reading the local database isn't a fetch.
ext.runtime.onStartup.addListener(() => void updateBadge().catch(() => {}));
ext.runtime.onInstalled.addListener(() => void updateBadge().catch(() => {}));
