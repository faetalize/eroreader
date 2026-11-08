import { describe, expect, it } from "vitest";
import {
  deadZone,
  DRAIN_PX_PER_SECOND,
  FAST_PAGE_SECONDS,
  formatSpeed,
  MAX_SPEED,
  MIN_PAGE_SECONDS,
  notches,
  PAGE_SECONDS,
  pageSeconds,
  PILL,
  pillSize,
  paceOf,
  PAGE_SECONDS_RANGE,
  speedFor,
  STRIP_SPEED_RANGE,
  placePill,
  positionOf,
  SETTLE_MS,
  Settler,
  speedAt,
  travel,
} from "../src/content/reader/auto/speed";

const H = PILL.track; // 320: the dead zone ends 19.2 px from the middle, 140.8 px of travel past it
const MIDDLE = H / 2;
const DEAD = deadZone(H);
const at = (reach: number, mode: "page" | "strip", direction: 1 | -1 = 1) => speedAt(MIDDLE + direction * (DEAD + reach), H, mode);

describe("the track", () => {
  it("leaves about 141 px past the dead zone on each side", () => {
    expect(DEAD).toBeCloseTo(19.2);
    expect(travel(H)).toBeCloseTo(140.8);
  });
});

describe("speedAt in strip mode", () => {
  it("starts at 0× at the dead zone's edge and reaches 4× at the ends", () => {
    expect(at(0.01, "strip").multiplier).toBeCloseTo(0, 3);
    expect(at(travel(H), "strip").multiplier).toBe(MAX_SPEED);
    expect(speedAt(0, H, "strip")).toMatchObject({ multiplier: MAX_SPEED, direction: -1 });
  });

  it("gets steeper toward the ends", () => {
    const step = (a: number, b: number) => at(b, "strip").multiplier - at(a, "strip").multiplier;
    expect(step(20, 40)).toBeLessThan(step(100, 120));
  });

  it("gives each range its share of the travel", () => {
    expect(at(60, "strip").range).toBe("slow"); // under 0.75× up to about 61 px
    expect(at(62, "strip").range).toBe("medium");
    expect(at(99, "strip").range).toBe("medium"); // up to 2× at about 100 px
    expect(at(101, "strip").range).toBe("fast");
  });
});

describe("speedAt in page mode", () => {
  it("measures the liquid from the dead zone's edge, a second every 12 px, with a floor", () => {
    expect(pageSeconds(DRAIN_PX_PER_SECOND * 3)).toBe(3);
    expect(pageSeconds(1)).toBe(MIN_PAGE_SECONDS);
    expect(pageSeconds(travel(H))).toBeCloseTo(11.73, 1);
    expect(at(0.5, "page").multiplier).toBe(PAGE_SECONDS / MIN_PAGE_SECONDS);
  });

  it("is fast at 2 s a page or less, slow past 0.75× (6.7 s), medium between", () => {
    expect(at(FAST_PAGE_SECONDS * DRAIN_PX_PER_SECOND, "page").range).toBe("fast"); // 24 px: 2 s
    expect(at(30, "page").range).toBe("medium"); // 2.5 s is moderate
    expect(at(79, "page").range).toBe("medium");
    expect(at(81, "page").range).toBe("slow");
    expect(at(travel(H), "page").range).toBe("slow");
  });

  it("slows down further from the middle", () => {
    const paces = [5, 20, 50, 100, 140].map((r) => at(r, "page").multiplier);
    expect([...paces].sort((a, b) => b - a)).toEqual(paces);
  });

  it("keeps the dead zone and the direction rules", () => {
    expect(speedAt(MIDDLE + DEAD - 1, H, "page")).toMatchObject({ multiplier: 0, range: "hold" });
    expect(at(50, "page", -1).direction).toBe(-1);
  });
});

describe("notches", () => {
  it("start at the dead zone's edge and mark every second in page mode, labelling 2, 5 and 10 s", () => {
    const page = notches("page");
    expect(page[0]).toEqual({ offset: DEAD, label: null, major: true });
    expect(page.map((n) => Math.round(n.offset - DEAD))).toEqual([0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132]);
    expect(page.filter((n) => n.label).map((n) => [Math.round(n.offset - DEAD), n.label])).toEqual([[24, "2s"], [60, "5s"], [120, "10s"]]);
  });

  it("start at 0× at the dead zone's edge in strip mode, where the curve puts each speed", () => {
    const strip = notches("strip");
    expect(strip[0]!.offset).toBe(DEAD);
    expect(strip.filter((n) => n.label).map((n) => n.label)).toEqual(["0.5×", "1×", "2×", "4×"]);
    for (const notch of strip.filter((n) => n.label)) {
      expect(speedAt(MIDDLE + notch.offset, H, "strip").multiplier).toBeCloseTo(parseFloat(notch.label!), 5);
    }
    expect(strip.at(-1)!.offset).toBe(MIDDLE);
  });
});

describe("Settler", () => {
  it("reports a range only after staying in it, once", () => {
    const settler = new Settler({ range: "medium", direction: 1 }, 0);
    expect(settler.update({ range: "fast", direction: 1 }, 100)).toBeNull();
    expect(settler.update({ range: "fast", direction: 1 }, 100 + SETTLE_MS - 1)).toBeNull();
    expect(settler.update({ range: "fast", direction: 1 }, 100 + SETTLE_MS)).toEqual({ range: "fast", direction: 1 });
    expect(settler.update({ range: "fast", direction: 1 }, 5000)).toBeNull();
  });

  it("ignores ranges passed through on the way", () => {
    const settler = new Settler({ range: "medium", direction: 1 }, 0);
    settler.update({ range: "slow", direction: 1 }, 0);
    settler.update({ range: "hold", direction: 1 }, 300);
    expect(settler.update({ range: "hold", direction: 1 }, 300 + SETTLE_MS)).toEqual({ range: "hold", direction: 1 });
  });

  it("doesn't report the starting state", () => {
    const settler = new Settler({ range: "slow", direction: -1 }, 0);
    expect(settler.update({ range: "slow", direction: -1 }, 5000)).toBeNull();
  });

  it("reports a change of direction at the same speed", () => {
    const settler = new Settler({ range: "medium", direction: 1 }, 0);
    settler.update({ range: "medium", direction: -1 }, 100);
    expect(settler.update({ range: "medium", direction: -1 }, 100 + SETTLE_MS)).toEqual({ range: "medium", direction: -1 });
  });
});

describe("formatSpeed", () => {
  it("shows the direction as an arrow", () => {
    expect(formatSpeed(1.24, 1)).toBe("↓1.2");
    expect(formatSpeed(2, -1)).toBe("↑2.0");
    expect(formatSpeed(0, -1)).toBe("0.0");
  });
});

describe("paces", () => {
  it("gives the speed for a pace in the mode's unit, and the pace back", () => {
    expect(speedFor("page", 2)).toMatchObject({ multiplier: 2.5, direction: 1, range: "fast" });
    expect(paceOf("page", speedFor("page", 2))).toBe(2);
    expect(paceOf("page", speedAt(PILL.track / 2 + deadZone(PILL.track) + 60, PILL.track, "page"))).toBe(5);
    expect(speedFor("strip", 0.75)).toMatchObject({ multiplier: 0.75, direction: 1, range: "medium" });
    expect(paceOf("strip", speedFor("strip", 0.75))).toBe(0.75);
  });

  it("keeps a pace within what the track reaches", () => {
    expect(paceOf("page", speedFor("page", 0.1))).toBe(PAGE_SECONDS_RANGE.min);
    expect(paceOf("page", speedFor("page", 60))).toBe(PAGE_SECONDS_RANGE.max);
    expect(speedFor("strip", 9).multiplier).toBe(STRIP_SPEED_RANGE.max);
    // The longest page pace is the track's end.
    expect(paceOf("page", speedAt(PILL.track, PILL.track, "page"))).toBeGreaterThanOrEqual(PAGE_SECONDS_RANGE.max);
  });
});

describe("pill placement", () => {
  const viewport = { width: 1200, height: 800 };
  const { width, height } = pillSize();

  it("sits near the right edge, clear of the scrollbar, with the track centered, by default", () => {
    const box = placePill(viewport, null);
    expect(box.left).toBe(1200 - width - PILL.margin);
    expect(box.top + PILL.grab + PILL.track / 2).toBe(400);
  });

  it("goes back where it was dragged, as a share of the free space", () => {
    const position = positionOf(100, 50, viewport);
    expect(placePill(viewport, position)).toMatchObject({ left: 100, top: 50 });
  });

  it("stays inside the viewport when it shrinks", () => {
    const position = positionOf(1200 - width, 800 - height, viewport); // bottom-right corner
    const box = placePill({ width: 600, height: 400 }, position);
    expect(box.left + box.width).toBeLessThanOrEqual(600);
    expect(box.top + box.height).toBeLessThanOrEqual(400);
    expect(placePill({ width: 600, height: 400 }, { x: 7, y: -3 })).toMatchObject({ left: 600 - width, top: 0 });
  });
});
