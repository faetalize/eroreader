import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, gridSizeText, HOVER_OFFSET_RANGE, HOVER_SCALE_RANGE, HOVER_WIDTH_MAX, hoverWidth, normalizeSettings, PRELOAD_CAP, THUMB_WIDTH_RANGE } from "../src/shared/settings";

describe("normalizeSettings", () => {
  it("uses the defaults for missing or broken values", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ preloadAhead: "x", preloadBehind: Number.NaN })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps whole, non-negative counts", () => {
    expect(normalizeSettings({ preloadAhead: 2.7, preloadBehind: -1 })).toMatchObject({ preloadAhead: 2, preloadBehind: 0 });
  });

  it("never preloads more than the cap in total", () => {
    expect(normalizeSettings({ preloadAhead: 50, preloadBehind: 50 })).toMatchObject({ preloadAhead: PRELOAD_CAP, preloadBehind: 0 });
    expect(normalizeSettings({ preloadAhead: 6, preloadBehind: 5 })).toMatchObject({ preloadAhead: 6, preloadBehind: 2 });
  });

  it("keeps a dragged auto zone position as shares of the free space", () => {
    expect(normalizeSettings({ autoZone: { x: 0.25, y: 2 } }).autoZone).toEqual({ x: 0.25, y: 1 });
    expect(normalizeSettings({ autoZone: { x: "a", y: 0 } }).autoZone).toBeNull();
    expect(normalizeSettings({}).autoZone).toBeNull();
  });

  it("keeps the hover sizes and thumbnail sizes in range", () => {
    expect(normalizeSettings({ hoverZoom: false, hoverSize: { filmstrip: { by: "offset", scale: 0.5, offset: 5, width: 1 }, grid: { by: "?", scale: 9, offset: 5000, width: 9000 } }, thumbWidth: { filmstrip: 10, grid: 1000 } })).toMatchObject({
      hoverZoom: false,
      hoverSize: {
        filmstrip: { by: "offset", scale: HOVER_SCALE_RANGE.min, offset: HOVER_OFFSET_RANGE.min, width: THUMB_WIDTH_RANGE.filmstrip.min },
        grid: { by: "scale", scale: HOVER_SCALE_RANGE.max, offset: HOVER_OFFSET_RANGE.max, width: HOVER_WIDTH_MAX },
      },
      thumbWidth: { filmstrip: THUMB_WIDTH_RANGE.filmstrip.min, grid: THUMB_WIDTH_RANGE.grid.max },
    });
    expect(normalizeSettings({ hoverSize: { filmstrip: { by: "width", scale: 2.345, offset: 123.4 } } }).hoverSize.filmstrip).toEqual({ by: "width", scale: 2.3, offset: 123, width: 200 });
    expect(normalizeSettings({ hoverZoom: "big", filmstripVertical: "yes", thumbWidth: null })).toMatchObject({
      hoverZoom: DEFAULT_SETTINGS.hoverZoom,
      hoverSize: DEFAULT_SETTINGS.hoverSize,
      filmstripVertical: false,
      thumbWidth: DEFAULT_SETTINGS.thumbWidth,
    });
  });
});

describe("normalizeSettings for older hover settings", () => {
  it("carries the old shared multiplier over as the switch and each view's multiplier", () => {
    expect(normalizeSettings({ hoverZoom: 2 })).toMatchObject({ hoverZoom: true, hoverSize: { filmstrip: { by: "scale", scale: 2 }, grid: { by: "scale", scale: 2 } } });
    expect(normalizeSettings({ hoverZoom: 1 })).toMatchObject({ hoverZoom: false, hoverSize: DEFAULT_SETTINGS.hoverSize });
  });

  it("carries a width in pixels over as that width", () => {
    expect(normalizeSettings({ hoverSize: { filmstrip: 240, grid: 300 } }).hoverSize).toMatchObject({ filmstrip: { by: "width", width: 240 }, grid: { by: "width", width: 300 } });
  });
});

describe("hoverWidth", () => {
  it("multiplies the thumbnail's width, or adds to it", () => {
    expect(hoverWidth(150, { by: "scale", scale: 2, offset: 30, width: 300 })).toBe(300);
    expect(hoverWidth(150, { by: "offset", scale: 2, offset: 200, width: 300 })).toBe(350);
  });

  it("takes a width of its own as it is", () => {
    expect(hoverWidth(150, { by: "width", scale: 2, offset: 30, width: 420 })).toBe(420);
  });

  it("is never less than a little wider than the thumbnail, whichever counts", () => {
    expect(hoverWidth(150, { by: "width", scale: 2, offset: 30, width: 100 })).toBe(180); // thumbnails grew past it
    expect(hoverWidth(80, { by: "scale", scale: 1.2, offset: 100, width: 300 })).toBe(110); // 96 raised to 80 + 30
    expect(hoverWidth(200, { by: "scale", scale: 1.2, offset: 100, width: 300 })).toBe(240); // above it already
    expect(hoverWidth(80, { by: "offset", scale: 5, offset: 30, width: 300 })).toBe(110);
  });
});

describe("normalizeSettings for the grid width", () => {
  it("keeps a width of at least the minimum, or the whole width", () => {
    expect(normalizeSettings({ gridWidth: 640.4 }).gridWidth).toBe(640);
    expect(normalizeSettings({ gridWidth: 10 }).gridWidth).toBe(200);
    expect(normalizeSettings({ gridWidth: "wide" }).gridWidth).toBeNull();
    expect(normalizeSettings({}).gridWidth).toBeNull();
    expect(normalizeSettings({ gridHeight: 50 }).gridHeight).toBe(200);
  });

  it("says how much space the grid has", () => {
    expect(gridSizeText({ gridWidth: null, gridHeight: null })).toBe("Full");
    expect(gridSizeText({ gridWidth: 900, gridHeight: null })).toBe("900 × full");
  });
});

describe("normalizeSettings for shortcuts", () => {
  it("keeps rebound keys for known actions only, normalized and without duplicates", () => {
    expect(normalizeSettings({ keys: { filmstrip: ["Y", "y", "Shift", 3], nope: ["x"], autoStop: [], autoLock: ["l"] } }).keys).toEqual({ filmstrip: ["y"], autoStop: [] }); // a lock key that's gone
    expect(normalizeSettings({ keys: "x" }).keys).toEqual({});
  });
});
