import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickSettings } from "../src/content/reader/quickSettings";
import { DEFAULT_SETTINGS, LiveSettings, normalizeSettings, type Settings } from "../src/shared/settings";

// Saving goes to storage and comes back later as a change; while a slider is dragged, several
// saves are on their way, and each echo is older than what's on screen.
describe("LiveSettings", () => {
  function make() {
    let stored: Settings = DEFAULT_SETTINGS;
    let listener: (settings: Settings) => void = () => {};
    const writes: { patch: Partial<Settings>; done: () => void }[] = [];
    const seen: Settings[] = [];
    const live = new LiveSettings(
      {
        load: async () => stored,
        update: (patch) => new Promise<void>((resolve) => writes.push({ patch, done: () => { stored = normalizeSettings({ ...stored, ...patch }); listener(stored); resolve(); } })),
        watch: (l) => (listener = l),
      },
      (settings) => seen.push(settings),
    );
    return { live, writes, seen, echo: (settings: Settings) => listener(settings) };
  }
  const width = (filmstrip: number) => ({ thumbWidth: { ...DEFAULT_SETTINGS.thumbWidth, filmstrip } });

  it("never lets the echo of an older save undo a newer one", async () => {
    const { live, writes, seen } = make();
    await Promise.resolve();
    live.save(width(150));
    live.save(width(160));
    writes[0]!.done(); // the first save's echo, with 250
    expect(live.get().thumbWidth.filmstrip).toBe(160);
    expect(seen.map((s) => s.thumbWidth.filmstrip)).not.toContain(150);
    writes[1]!.done();
    expect(live.get().thumbWidth.filmstrip).toBe(160);
  });

  it("still takes changes made elsewhere, under its own newer ones", async () => {
    const { live, echo, seen } = make();
    await Promise.resolve();
    live.save(width(160));
    echo({ ...DEFAULT_SETTINGS, toolbarPinned: true }); // another tab, before our save landed
    expect([live.get().toolbarPinned, live.get().thumbWidth.filmstrip]).toEqual([true, 160]);
    expect(seen.at(-1)!.thumbWidth.filmstrip).toBe(160);
  });
});

describe("updateSettings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps every change when saves overlap", async () => {
    let stored: unknown = undefined;
    const slow = () => new Promise((resolve) => setTimeout(resolve, 5));
    vi.stubGlobal("browser", {
      storage: {
        local: {
          get: async () => (await slow(), { settings: stored }),
          set: async (items: { settings: unknown }) => (await slow(), (stored = items.settings)),
        },
        onChanged: { addListener() {}, removeListener() {} },
      },
    });
    vi.resetModules();
    const { updateSettings } = await import("../src/shared/settings");
    await Promise.all([updateSettings({ toolbarPinned: true }), updateSettings({ preloadAhead: 5 })]);
    expect(stored).toMatchObject({ toolbarPinned: true, preloadAhead: 5 });
  });
});

describe("QuickSettings sliders", () => {
  it("leave a slider alone while it's held, whatever settings arrive meanwhile", () => {
    let settings: Settings = DEFAULT_SETTINGS;
    const quick = new QuickSettings({ doc: document, settings: () => settings, save: (patch) => (settings = normalizeSettings({ ...settings, ...patch })) });
    document.body.append(quick.element);
    quick.open();
    const slider = quick.element.querySelector<HTMLInputElement>('input[name="filmstripSize"]')!;
    slider.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    slider.value = "150";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    quick.update(DEFAULT_SETTINGS); // an older echo
    expect(slider.value).toBe("150");
    slider.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    quick.update(settings);
    expect(slider.value).toBe("150");
    quick.update(DEFAULT_SETTINGS); // let go: it shows what's stored again
    expect(slider.value).toBe(String(DEFAULT_SETTINGS.thumbWidth.filmstrip));
    document.body.innerHTML = "";
  });
});
