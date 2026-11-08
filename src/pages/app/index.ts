// The extension's own page: History and Settings in one shell. history.html opens on History
// (the toolbar icon), settings.html on Settings (the add-on's options link).
import { BackupError, exportBackup, parseBackup, restoreBackup, type Backup } from "../../background/backup";
import { database } from "../../background/schema";
import { ext } from "../../shared/browser";
import { loadCharacter, parseCharacter, saveCharacter, watchCharacter, type Character } from "../../shared/character";
import { send, type AppFocusMessage, type AppTab } from "../../shared/messages";
import { LiveSettings, loadSettings, updateSettings, watchSettings, type Settings } from "../../shared/settings";
import { button, h } from "./dom";
import { HistoryView } from "./historyView";
import { restoredText } from "./restoredText";
import { SettingsView } from "./settingsView";

type Section = "history" | "settings";
const FILES: Record<Section, string> = { history: "history.html", settings: "settings.html" };
const TITLES: Record<Section, string> = { history: "History", settings: "Settings" };

interface DialogParts {
  title: string;
  subtitle?: string;
  body: Node[];
  option?: { label: string; note?: string }; // one unticked checkbox
  confirm: string;
  danger?: boolean;
}

// A modal question. Resolves to whether its option was ticked (false without one), or null when
// cancelled: by its button, Esc, or a click outside.
function dialog(parts: DialogParts): Promise<boolean | null> {
  return new Promise((resolve) => {
    const checkbox = h("input", { type: "checkbox" });
    const close = (answer: boolean | null) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(null);
    };
    const confirm = button(parts.confirm, () => close(parts.option ? checkbox.checked : false), parts.danger ? "danger" : "primary");
    const overlay = h(
      "div",
      { className: "overlay", on: { click: (event) => event.target === overlay && close(null) } },
      h(
        "div",
        { className: "dialog", attrs: { role: "dialog", "aria-modal": "true", "aria-label": parts.title } },
        h("h2", { text: parts.title }),
        parts.subtitle ? h("p", { className: "subtitle", text: parts.subtitle }) : null,
        ...parts.body,
        parts.option
          ? h("label", { className: "option" }, checkbox, h("span", {}, parts.option.label, parts.option.note ? h("span", { className: "note", text: parts.option.note }) : null))
          : null,
        h("div", { className: "buttons" }, button("Cancel", () => close(null)), confirm),
      ),
    );
    document.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    confirm.focus();
  });
}

// Asks before clearing everything, with the choice to clear reading progress too.
async function confirmClear(): Promise<{ progress: boolean } | null> {
  const progress = await dialog({
    title: "Clear everything?",
    body: [h("p", { text: "All galleries, covers and searches in the history are deleted. You can undo it for a few seconds afterwards." })],
    option: { label: "Also clear reading progress" },
    confirm: "Clear everything",
    danger: true,
  });
  return progress === null ? null : { progress };
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function contents(backup: Pick<Backup, "progress" | "galleries" | "searches" | "covers">): string {
  return `${plural(backup.galleries.length, "gallery", "galleries")}, progress for ${backup.progress.length}, ${plural(backup.searches.length, "search", "searches")} and ${plural(backup.covers.length, "cover")}`;
}

// What a backup holds, as a short two-column list.
function contentsList(backup: Backup): HTMLElement {
  const rows: [string, number][] = [["Galleries", backup.galleries.length], ["Reading progress", backup.progress.length], ["Searches", backup.searches.length], ["Covers", backup.covers.length]];
  return h("dl", { className: "contents" }, ...rows.flatMap(([label, count]) => [h("dt", { text: label }), h("dd", { text: count.toLocaleString() })]));
}

// Downloads `blob` as a file named `name`.
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function saveBackup(settings: Settings): Promise<string> {
  const now = new Date();
  const backup = await exportBackup(await database(), settings, now.getTime(), await loadCharacter());
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  download(new Blob([JSON.stringify(backup)], { type: "application/json" }), `eroreader-backup-${day}.json`);
  return `Saved a backup with ${contents(backup)}.`;
}

// Restores a backup file after showing what it holds. Returns what happened, to show.
async function restoreFile(file: File): Promise<string | null> {
  let backup: Backup;
  try {
    backup = parseBackup(await file.text());
  } catch (error) {
    return error instanceof BackupError ? error.message : "That file couldn't be read.";
  }
  const when = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  const withSettings = await dialog({
    title: "Restore this backup?",
    subtitle: when ? `Saved ${when}` : undefined,
    body: [
      contentsList(backup),
      h("p", { text: "Added to what's here. Nothing is deleted." }),
    ],
    option: { label: backup.character ? "Also restore its settings, shortcuts and character" : "Also restore its settings and shortcuts", note: "Replaces the current ones." },
    confirm: "Restore",
  });
  if (withSettings === null) return null;
  const summary = await restoreBackup(await database(), backup);
  if (withSettings) await updateSettings(backup.settings);
  if (withSettings && backup.character) await saveCharacter(backup.character);
  await send("storageChanged", {}).catch(() => {}); // the toolbar badge
  return restoredText(summary, withSettings, withSettings && backup.character !== null);
}


async function main(): Promise<void> {
  // Saves apply at once; what storage reports back never undoes a newer change (see
  // LiveSettings).
  let onSettings: (next: Settings) => void = () => {};
  const settings = new LiveSettings({ load: loadSettings, update: updateSettings, watch: watchSettings }, (next) => onSettings(next), await loadSettings());
  let character: Character | null = await loadCharacter();
  const settingsView = new SettingsView({
    get: () => settings.get(),
    save: async (patch) => settings.save(patch),
    backup: { save: () => saveBackup(settings.get()), restore: restoreFile },
    character: {
      current: () => character,
      load: async (file) => {
        character = parseCharacter(await file.text(), file.name.replace(/\.json$/i, ""));
        await saveCharacter(character);
      },
      remove: async () => {
        character = null;
        await saveCharacter(null);
      },
    },
  });
  onSettings = (next) => settingsView.update(next);
  watchCharacter((next) => {
    character = next;
    settingsView.showCharacter(next);
  });
  const historyView = new HistoryView({
    db: database,
    fetch: (input, init) => fetch(input, init),
    open: (url) => void window.open(url, "_blank", "noreferrer"),
    confirmClear,
  });

  const views: Record<Section, HTMLElement> = { history: historyView.element, settings: settingsView.element };
  const tabs = new Map<Section, HTMLButtonElement>();
  let historyStarted = false;
  const show = (section: Section) => {
    for (const [name, tab] of tabs) tab.setAttribute("aria-selected", String(name === section));
    for (const [name, view] of Object.entries(views)) view.hidden = name !== section;
    document.title = `${TITLES[section]} · eroreader`;
    const path = location.pathname.replace(/[^/]*$/, FILES[section]);
    if (location.pathname !== path) history.replaceState(null, "", path);
    if (section === "history" && !historyStarted) {
      historyStarted = true;
      void historyView.start();
    } else if (section === "history") {
      void historyView.refreshIfChanged();
    }
  };
  // Back from other tabs, where galleries may have been opened.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && historyStarted && !historyView.element.hidden) void historyView.refreshIfChanged();
  });
  const nav = h(
    "nav",
    { className: "tabs", attrs: { role: "tablist" } },
    ...(["history", "settings"] as Section[]).map((section) => {
      const tab = button(TITLES[section], () => show(section));
      tab.setAttribute("role", "tab");
      tabs.set(section, tab);
      return tab;
    }),
  );
  document.getElementById("app")!.append(h("header", {}, h("h1", { text: "eroreader" }), nav), h("main", {}, ...Object.values(views)));
  show(location.pathname.endsWith(FILES.settings) ? "settings" : "history");
  // The toolbar icon and the reader's "All settings…" bring this tab back instead of opening
  // another: the background asks, and this page answers with its tab.
  ext.runtime.onMessage.addListener(((message: unknown, _sender: unknown, sendResponse: (tab: AppTab | null) => void) => {
    const focus = message as Partial<AppFocusMessage> | null;
    if (focus?.type !== "appFocus") return undefined;
    if (focus.section) show(focus.section);
    void ext.tabs
      .getCurrent()
      .then((tab) => sendResponse(tab?.id !== undefined ? { tabId: tab.id, windowId: tab.windowId! } : null))
      .catch(() => sendResponse(null));
    return true; // answers asynchronously
  }) as Parameters<typeof ext.runtime.onMessage.addListener>[0]);
}

void main();
