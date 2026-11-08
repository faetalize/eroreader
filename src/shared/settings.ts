// User settings, kept in storage.local.
import { ext } from "./browser";
import { ACTIONS, AUTO_ACTIONS, isBindableKey, normalizeKey, type KeyOverrides } from "../content/reader/shortcuts";
import { PAGE_SECONDS_RANGE, STRIP_SPEED_RANGE } from "../content/reader/auto/speed";

export type ThumbView = "filmstrip" | "grid";

// How large a hovered thumbnail shows: a multiplier of its width, a number of pixels added to
// it, or a width of its own. All three are kept, so switching back finds the value as it was.
export interface HoverSize {
  by: "scale" | "offset" | "width";
  scale: number;
  offset: number; // px
  width: number; // px
}

export interface Settings {
  preloadAhead: number;
  preloadBehind: number;
  hoverZoom: boolean; // a hovered thumbnail in the filmstrip or grid shows larger
  hoverSize: Record<ThumbView, HoverSize>; // how much larger that copy is, per view
  filmstripVertical: boolean; // on the left edge instead of along the bottom
  thumbWidth: Record<ThumbView, number>; // px
  gridWidth: number | null; // px the grid spans, for fewer columns without larger thumbnails; null for all
  gridHeight: number | null; // likewise, how tall it is; null for all
  autoZone: { x: number; y: number } | null; // where the auto zone pill was dragged; null for the default
  // Hands-free paces, per reading mode: seconds per page, or the scroll speed multiplier.
  autoPace: { page: number | null; strip: number | null }; // the last one used, if any
  autoDefaultPace: { page: number; strip: number }; // when there's no last one
  toolbarPinned: boolean; // the reader's toolbar stays shown instead of hiding when idle
  recordingPaused: boolean; // history (galleries, searches, covers) isn't recorded; progress still is
  keys: KeyOverrides; // shortcuts the user rebound
}

export const DEFAULT_SETTINGS: Settings = {
  preloadAhead: 3,
  preloadBehind: 1,
  hoverZoom: true,
  hoverSize: { filmstrip: { by: "scale", scale: 2.5, offset: 100, width: 200 }, grid: { by: "scale", scale: 2, offset: 100, width: 300 } },
  filmstripVertical: false,
  thumbWidth: { filmstrip: 80, grid: 150 },
  gridWidth: null,
  gridHeight: null,
  autoZone: null,
  autoPace: { page: null, strip: null },
  autoDefaultPace: { page: 2, strip: 0.75 },
  toolbarPinned: false,
  recordingPaused: false,
  keys: {},
};

// Pages preloaded besides the ones on screen, at most, so preloading never burns through
// the image limit.
export const PRELOAD_CAP = 8;

// Thumbnails are about 200 px wide, so larger copies are enlarged and softer: fine for a glance.
export const HOVER_SCALE_RANGE = { min: 1.2, max: 5 };
export const HOVER_OFFSET_RANGE = { min: 30, max: 1000 };
export const HOVER_OFFSETS = [30, 100, 200]; // offered as they are; others are typed in
// A width of its own goes from the thumbnail's width (whatever it is at the time) to this.
export const HOVER_WIDTH_MAX = 1200;
// However it's set, the hovered copy is at least this much wider than the thumbnail, so it's
// always a real enlargement (1.2 × a small thumbnail would hardly show).
export const HOVER_MIN_GAIN = 30;

// How wide a hovered thumbnail `thumbWidth` wide shows.
export function hoverWidth(thumbWidth: number, size: HoverSize): number {
  const wanted = size.by === "scale" ? thumbWidth * size.scale : size.by === "offset" ? thumbWidth + size.offset : size.width;
  return Math.round(Math.max(thumbWidth + HOVER_MIN_GAIN, wanted));
}
export const MIN_GRID_SIZE = 200;

export const THUMB_WIDTH_RANGE: Record<ThumbView, { min: number; max: number }> = {
  filmstrip: { min: 48, max: 200 },
  grid: { min: 80, max: 360 },
};

const clamp = (value: number, range: { min: number; max: number }) => Math.min(range.max, Math.max(range.min, value));

const ACTION_IDS = new Set<string>([...ACTIONS, ...AUTO_ACTIONS].map((action) => action.id));

function keyOverrides(value: unknown): KeyOverrides {
  if (typeof value !== "object" || value === null) return {};
  const out: KeyOverrides = {};
  for (const [id, keys] of Object.entries(value)) {
    if (!ACTION_IDS.has(id) || !Array.isArray(keys)) continue;
    const valid = keys.filter((key): key is string => typeof key === "string" && isBindableKey(key)).map(normalizeKey);
    out[id as keyof KeyOverrides] = [...new Set(valid)];
  }
  return out;
}

function autoZone(value: unknown): Settings["autoZone"] {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

const toScale = (value: number) => Math.round(clamp(value, HOVER_SCALE_RANGE) * 10) / 10;
const toWidth = (value: number) => Math.round(clamp(value, { min: THUMB_WIDTH_RANGE.filmstrip.min, max: HOVER_WIDTH_MAX }));

// Earlier versions kept hover zoom as one multiplier for both views (1 meaning off), then as a
// width in pixels per view: they carry over as a multiplier and a width of its own.
function hover(raw: Partial<Record<keyof Settings, unknown>>, thumbWidth: (view: ThumbView) => number): Pick<Settings, "hoverZoom" | "hoverSize"> {
  const sizes = (typeof raw.hoverSize === "object" && raw.hoverSize !== null ? raw.hoverSize : {}) as Partial<Record<ThumbView, unknown>>;
  const old = typeof raw.hoverZoom === "number" && Number.isFinite(raw.hoverZoom) ? raw.hoverZoom : null;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const size = (view: ThumbView): HoverSize => {
    const fallback = DEFAULT_SETTINGS.hoverSize[view];
    const value = sizes[view];
    if (finite(value)) return { ...fallback, by: "width", width: toWidth(value) };
    if (typeof value === "object" && value !== null) {
      const { by, scale, offset, width } = value as Record<string, unknown>;
      return {
        by: by === "offset" || by === "width" ? by : "scale",
        scale: finite(scale) ? toScale(scale) : fallback.scale,
        offset: finite(offset) ? Math.round(clamp(offset, HOVER_OFFSET_RANGE)) : fallback.offset,
        width: finite(width) ? toWidth(width) : fallback.width,
      };
    }
    if (old !== null && old > 1) return { ...fallback, scale: toScale(old) };
    return { ...fallback };
  };
  return {
    hoverZoom: typeof raw.hoverZoom === "boolean" ? raw.hoverZoom : old !== null ? old > 1 : DEFAULT_SETTINGS.hoverZoom,
    hoverSize: { filmstrip: size("filmstrip"), grid: size("grid") },
  };
}

function paces(raw: Partial<Record<keyof Settings, unknown>>): Pick<Settings, "autoPace" | "autoDefaultPace"> {
  const record = (value: unknown) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});
  const pace = (value: unknown, range: { min: number; max: number }) =>
    typeof value === "number" && Number.isFinite(value) ? Math.round(clamp(value, range) * 100) / 100 : null;
  const last = record(raw.autoPace);
  const defaults = record(raw.autoDefaultPace);
  return {
    autoPace: { page: pace(last.page, PAGE_SECONDS_RANGE), strip: pace(last.strip, STRIP_SPEED_RANGE) },
    autoDefaultPace: {
      page: pace(defaults.page, PAGE_SECONDS_RANGE) ?? DEFAULT_SETTINGS.autoDefaultPace.page,
      strip: pace(defaults.strip, STRIP_SPEED_RANGE) ?? DEFAULT_SETTINGS.autoDefaultPace.strip,
    },
  };
}

const gridSize = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(MIN_GRID_SIZE, value)) : null);

export function normalizeSettings(value: unknown): Settings {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Partial<Record<keyof Settings, unknown>>;
  const number = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const count = (v: unknown, fallback: number) => Math.max(0, Math.floor(number(v, fallback)));
  const ahead = Math.min(PRELOAD_CAP, count(raw.preloadAhead, DEFAULT_SETTINGS.preloadAhead));
  const behind = Math.min(PRELOAD_CAP - ahead, count(raw.preloadBehind, DEFAULT_SETTINGS.preloadBehind));
  const widths = (typeof raw.thumbWidth === "object" && raw.thumbWidth !== null ? raw.thumbWidth : {}) as Partial<Record<ThumbView, unknown>>;
  const width = (view: ThumbView) => Math.round(clamp(number(widths[view], DEFAULT_SETTINGS.thumbWidth[view]), THUMB_WIDTH_RANGE[view]));
  return {
    preloadAhead: ahead,
    preloadBehind: behind,
    ...hover(raw, (view) => width(view)),
    filmstripVertical: typeof raw.filmstripVertical === "boolean" ? raw.filmstripVertical : DEFAULT_SETTINGS.filmstripVertical,
    thumbWidth: { filmstrip: width("filmstrip"), grid: width("grid") },
    gridWidth: gridSize(raw.gridWidth),
    gridHeight: gridSize(raw.gridHeight),
    autoZone: autoZone(raw.autoZone),
    ...paces(raw),
    toolbarPinned: raw.toolbarPinned === true,
    recordingPaused: raw.recordingPaused === true,
    keys: keyOverrides(raw.keys),
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const { settings } = await ext.storage.local.get("settings");
    return normalizeSettings(settings);
  } catch {
    return normalizeSettings(undefined);
  }
}

// Writes run one after another: each reads what the last one stored, so overlapping saves
// (a slider dragged, two settings changed at once) never lose each other's changes.
let writes: Promise<unknown> = Promise.resolve();

// Merges `patch` into the stored settings and returns the result.
export function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const write = writes.then(async () => {
    const next = normalizeSettings({ ...(await loadSettings()), ...patch });
    await ext.storage.local.set({ settings: next });
    return next;
  });
  writes = write.catch(() => {});
  return write;
}

// Calls `listener` whenever the stored settings change, from any tab or the options page.
export function watchSettings(listener: (settings: Settings) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === "local" && "settings" in changes) listener(normalizeSettings(changes.settings!.newValue));
  };
  ext.storage.onChanged.addListener(onChanged);
  return () => ext.storage.onChanged.removeListener(onChanged);
}

export interface LiveSettingsDeps {
  load: () => Promise<Settings>;
  update: (patch: Partial<Settings>) => Promise<unknown>;
  watch: (listener: (settings: Settings) => void) => unknown;
}

// The settings a page works with: its own changes apply at once and are saved in the
// background; changes stored from anywhere arrive through `watch` and are passed on.
// What storage reports can be older than what's on screen: while a slider is dragged, each
// save comes back after newer ones were made. So the page's saves still on their way are laid
// over whatever arrives, and an old echo never undoes a newer change.
export class LiveSettings {
  #current: Settings = DEFAULT_SETTINGS;
  readonly #deps: LiveSettingsDeps;
  readonly #pending: Partial<Settings>[] = []; // saves not yet stored, oldest first

  constructor(deps: LiveSettingsDeps, onChange: (settings: Settings) => void, initial?: Settings) {
    this.#deps = deps;
    if (initial) this.#current = initial;
    void deps.load().then((loaded) => (this.#current = this.#withPending(loaded))).catch(() => {});
    deps.watch((next) => {
      this.#current = this.#withPending(next);
      onChange(this.#current);
    });
  }

  get(): Settings {
    return this.#current;
  }

  save(patch: Partial<Settings>): void {
    this.#current = normalizeSettings({ ...this.#current, ...patch });
    this.#pending.push(patch);
    const done = () => this.#pending.splice(this.#pending.indexOf(patch), 1);
    void this.#deps.update(patch).then(done, done);
  }

  #withPending(stored: Settings): Settings {
    return this.#pending.length ? normalizeSettings(Object.assign({}, stored, ...this.#pending)) : stored;
  }
}

// The grid's size as set by its handles, e.g. "900 × full" or "Full".
export function gridSizeText(settings: Pick<Settings, "gridWidth" | "gridHeight">): string {
  const { gridWidth: width, gridHeight: height } = settings;
  if (width === null && height === null) return "Full";
  return `${width ?? "full"} × ${height ?? "full"}`;
}
