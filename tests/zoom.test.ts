import { describe, expect, it } from "vitest";
import { displaySize, FIT, fitScale, MAX_SCALE, zoomStep } from "../src/content/reader/zoom";

const viewport = { width: 1000, height: 800 };

describe("zoom", () => {
  it("fits the whole page, scaling small pages up", () => {
    expect(displaySize({ width: 1280, height: 1810 }, viewport, FIT)).toEqual({ width: 566, height: 800 });
    expect(displaySize({ width: 2000, height: 500 }, viewport, FIT)).toEqual({ width: 1000, height: 250 });
    expect(fitScale({ width: 200, height: 100 }, viewport)).toBe(5);
  });

  it("draws at a scale of the real size", () => {
    expect(displaySize({ width: 1280, height: 1810 }, viewport, { fit: false, scale: 1 })).toEqual({ width: 1280, height: 1810 });
  });

  it("steps from the size the page has now", () => {
    const natural = { width: 1000, height: 1600 }; // fits at 0.5
    expect(zoomStep(FIT, natural, viewport, 1)).toEqual({ fit: false, scale: 0.625 });
    expect(zoomStep({ fit: false, scale: 1 }, natural, viewport, -1)).toEqual({ fit: false, scale: 0.8 });
    expect(zoomStep({ fit: false, scale: MAX_SCALE }, natural, viewport, 1)).toEqual({ fit: false, scale: MAX_SCALE });
  });
});
