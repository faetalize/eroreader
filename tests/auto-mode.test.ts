import { describe, expect, it } from "vitest";
import { AutoMode, type SpeedReport } from "../src/content/reader/auto/autoMode";
import type { AutoEvent } from "../src/content/reader/auto/messages";
import { deadZone, DRAIN_PX_PER_SECOND, DWELL_MS, MAX_SPEED, pageSeconds, PILL, placePill, SETTLE_MS, speedAt, speedFor, STRIP_PX_PER_SECOND, type PillPosition } from "../src/content/reader/auto/speed";

const VIEW = { width: 1000, height: 1000 };
// The pill's default place in a 1000 × 1000 viewport, and spots on its track.
const BOX = placePill(VIEW, null);
const TRACK_TOP = BOX.top + PILL.grab;
const EDGE = BOX.left + BOX.width / 2; // x in the pill's column
const MIDDLE = TRACK_TOP + PILL.track / 2;
const BOTTOM = TRACK_TOP + PILL.track - 1; // forward: fastest in strip mode, slowest in page mode
const TOP = TRACK_TOP; // back, likewise
const DEAD = deadZone(PILL.track);
const NEAR_DOWN = MIDDLE + DEAD + 22; // forward, 22 px past the dead zone: about 1.8 s a page, fast
const NEAR_UP = MIDDLE - DEAD - 22;
const NEAR_MS = pageSeconds(22) * 1000;
const OUTSIDE = BOX.left - 200;

function setup({ mode: initialMode = "page" as "page" | "strip", pageCount = 100, start = 10, scrollRoom = Infinity } = {}) {
  let mode = initialMode;
  const paces: [string, number][] = [];
  let now = 0;
  let viewport = { ...VIEW };
  let position: PillPosition | null = null;
  const moves: PillPosition[] = [];
  let frames: ((time: number) => void)[] = [];
  let page = start;
  let scrolled = 0;
  const events: AutoEvent[] = [];
  const speeds: (SpeedReport | null)[] = [];
  const auto = new AutoMode({
    doc: document,
    mode: () => mode,
    viewport: () => viewport,
    position: () => position,
    onMove: (p) => {
      moves.push(p);
      position = p;
    },
    step: (direction) => {
      const next = page + direction;
      if (next < 1 || next > pageCount) return false;
      page = next;
      auto.pageShown(page, pageCount);
      return true;
    },
    scrollBy: (dy) => {
      if (scrolled + dy > scrollRoom || scrolled + dy < 0) return false;
      scrolled += dy;
      return true;
    },
    atLastPage: () => page === pageCount,
    emit: (event) => events.push(event),
    onSpeed: (multiplier) => speeds.push(multiplier),
    onLastPace: (m, pace) => paces.push([m, pace]),
    now: () => now,
    requestFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelFrame: () => {},
  });
  auto.pageShown(page, pageCount);
  // Runs frames 16 ms apart for `ms`.
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      now += 16;
      const due = frames;
      frames = [];
      due.forEach((callback) => callback(now));
    }
  };
  const move = (x: number, y: number, { overUi = false, buttons = 0 } = {}) => auto.pointer(x, y, overUi, buttons);
  const resize = (width: number, height: number) => {
    viewport = { width, height };
    auto.layout();
  };
  return {
    auto, events, speeds, advance, move, resize, moves, paces,
    setMode: (next: "page" | "strip") => (mode = next),
    page: () => page,
    scrolled: () => scrolled,
    gauge: () => auto.element.querySelector<HTMLElement>(".gauge")!,
  };
}

describe("AutoMode", () => {
  it("starts only after the cursor rests in the zone", () => {
    const { auto, events, advance, move } = setup();
    move(EDGE, BOTTOM);
    advance(DWELL_MS - 40);
    move(OUTSIDE, BOTTOM); // passed over it
    advance(500);
    expect(events).toEqual([]);
    move(EDGE, BOTTOM);
    advance(DWELL_MS + 20);
    expect(events).toEqual(["start"]);
    expect(auto.state).toBe("running");
  });

  it("doesn't start over the toolbar or other controls, or while a button is held", () => {
    const { events, advance, move } = setup();
    move(EDGE, 20, { overUi: true });
    advance(500);
    move(EDGE, BOTTOM, { buttons: 1 }); // dragging the scrollbar
    advance(500);
    expect(events).toEqual([]);
  });

  it("stops when the cursor leaves, and waits for it to leave before starting again", () => {
    const { auto, events, advance, move } = setup();
    move(EDGE, BOTTOM);
    advance(300);
    move(OUTSIDE, BOTTOM);
    expect(events).toEqual(["start", "stopped"]);
    move(EDGE, BOTTOM);
    advance(300);
    expect(auto.state).toBe("running"); // it left, so a new rest starts again
  });

  it("locks with Space so it keeps going outside the zone, and Space again stops it", () => {
    const { auto, events, advance, move, page } = setup();
    move(EDGE, NEAR_DOWN);
    advance(300);
    expect(auto.toggleLock()).toBe(true);
    move(OUTSIDE, 100);
    advance(3000);
    expect(auto.state).toBe("locked");
    expect(page()).toBeGreaterThan(10);
    expect(auto.toggleLock()).toBe(true);
    expect(events).toEqual(["start", "locked", "stopped"]);
    move(EDGE, BOTTOM); // after a stop the cursor has to leave first; it's already outside
    advance(300);
    expect(auto.state).toBe("running");
  });

  it("starts locked at a given pace, wherever the cursor is, and stops when asked", () => {
    const { auto, events, advance, page, speeds, paces } = setup();
    expect(auto.startLocked(speedFor("page", 2))).toBe(true);
    expect([auto.state, events]).toEqual(["locked", ["start"]]);
    expect(speeds.at(-1)).toMatchObject({ multiplier: 2.5, direction: 1, locked: true });
    expect(auto.startLocked(speedFor("page", 5))).toBe(false); // already running
    advance(2100);
    expect(page()).toBe(11); // 2 s a page
    expect(auto.stop()).toBe(true);
    expect([auto.state, events.at(-1), paces]).toEqual(["idle", "stopped", [["page", 2]]]);
    expect(auto.stop()).toBe(false);
  });

  it("reports the pace a session ran at under the mode it ran in, even when a mode change stops it", () => {
    const { auto, paces, setMode, move } = setup({ mode: "strip" });
    move(EDGE, BOTTOM); // fastest
    auto.startLocked(speedFor("strip", 1.5));
    setMode("page");
    auto.modeChanged();
    expect(paces).toEqual([["strip", 1.5]]);
  });

  it("leaves Space alone when it isn't running", () => {
    expect(setup().auto.toggleLock()).toBe(false);
  });

  it("stops on Esc, and when the cursor leaves the window unless locked", () => {
    const a = setup();
    a.move(EDGE, BOTTOM);
    a.advance(300);
    a.auto.toggleLock();
    expect(a.auto.escape()).toBe(true);
    expect(a.events.at(-1)).toBe("stopped");
    expect(a.auto.escape()).toBe(false);

    const b = setup();
    b.move(EDGE, BOTTOM);
    b.advance(300);
    b.auto.leaveWindow(); // steered on the pill: it ends
    expect([b.auto.state, b.events]).toEqual(["idle", ["start", "stopped"]]);

    const c = setup();
    c.move(EDGE, BOTTOM);
    c.advance(300);
    c.auto.toggleLock();
    c.auto.leaveWindow(); // locked: it needs no cursor
    expect([c.auto.state, c.events]).toEqual(["locked", ["start", "locked"]]);
  });

  it("turns pages fastest near the middle and slowest far from it, and holds still in the dead zone", () => {
    const { advance, move, page } = setup();
    move(EDGE, NEAR_DOWN);
    advance(DWELL_MS + 16);
    advance(NEAR_MS * 2 + 50);
    expect(page()).toBe(12);
    move(EDGE, BOTTOM); // about 11.7 s of liquid
    advance(11_000);
    expect(page()).toBe(12);
    advance(1_500);
    expect(page()).toBe(13);
    move(EDGE, MIDDLE);
    advance(20_000);
    expect(page()).toBe(13);
  });

  it("goes back above the middle", () => {
    const { advance, move, page } = setup();
    move(EDGE, NEAR_UP);
    advance(DWELL_MS + 16 + NEAR_MS + 50);
    expect(page()).toBe(9);
  });

  it("stops at the end of the gallery instead of looping", () => {
    const { auto, events, advance, move, page } = setup({ start: 99 });
    move(EDGE, NEAR_DOWN);
    advance(5000);
    expect(page()).toBe(100);
    expect(auto.state).toBe("idle");
    expect(events.at(-1)).toBe("end");
    expect(events).not.toContain("stopped");
  });

  it("reports a speed range once it settles, and a turn back as reverse", () => {
    const { events, advance, move } = setup();
    move(EDGE, NEAR_DOWN);
    advance(300);
    move(EDGE, BOTTOM);
    advance(SETTLE_MS - 100);
    move(EDGE, MIDDLE); // passed fast on the way, too briefly to count
    advance(SETTLE_MS + 50);
    move(EDGE, TOP + 100);
    advance(SETTLE_MS + 50);
    expect(events).toEqual(["start", "speed_hold", "reverse"]);
  });

  it("starting in the upper half is only a start", () => {
    const { events, advance, move } = setup();
    move(EDGE, TOP + 100);
    advance(2000);
    expect(events).toEqual(["start"]);
  });

  it("says halfway and almost at the end once each, going forward", () => {
    const { events, advance, move } = setup({ pageCount: 20, start: 8 });
    move(EDGE, NEAR_DOWN);
    advance(30_000);
    expect(events.filter((e) => e === "halfway" || e === "almost_end" || e === "end")).toEqual(["halfway", "almost_end", "end"]);
  });

  it("drains the liquid at a constant pace in page mode, and refills on the page turn", () => {
    const { advance, move, gauge } = setup();
    move(EDGE, BOTTOM);
    advance(DWELL_MS + 16);
    const full = parseFloat(gauge().style.height);
    expect(full).toBeGreaterThan(PILL.track / 2 - DEAD - 2); // the cursor's reach past the dead zone
    expect(gauge().style.top).toBe(`${PILL.track / 2 + DEAD}px`); // forward: from the dead zone's edge down
    advance(1008);
    expect(full - parseFloat(gauge().style.height)).toBeCloseTo(DRAIN_PX_PER_SECOND, 0);
    move(EDGE, MIDDLE + 60); // less liquid: the column shrinks at once, and keeps draining as fast
    const resized = parseFloat(gauge().style.height);
    expect(resized).toBeLessThan(60 - DEAD);
    advance(1008);
    expect(resized - parseFloat(gauge().style.height)).toBeCloseTo(DRAIN_PX_PER_SECOND, 0);
  });

  it("refills right after a page turns", () => {
    const { advance, move, gauge, page } = setup();
    move(EDGE, NEAR_DOWN);
    advance(DWELL_MS + 16 + NEAR_MS - 100);
    expect(parseFloat(gauge().style.height)).toBeLessThan(3);
    advance(150);
    expect(page()).toBe(11);
    expect(parseFloat(gauge().style.height)).toBeGreaterThan(20);
  });

  it("counts near the middle as fast and far from it as slow in page mode, the other way in strip mode", () => {
    const page = setup();
    page.move(EDGE, MIDDLE + 60); // about 3.4 s a page: medium
    page.advance(300);
    page.move(EDGE, NEAR_DOWN);
    page.advance(SETTLE_MS + 50);
    page.move(EDGE, BOTTOM);
    page.advance(SETTLE_MS + 50);
    expect(page.events).toEqual(["start", "speed_fast", "speed_slow"]);

    const strip = setup({ mode: "strip" });
    strip.move(EDGE, MIDDLE + DEAD + 80); // about 1.3×: medium
    strip.advance(300);
    strip.move(EDGE, NEAR_DOWN);
    strip.advance(SETTLE_MS + 50);
    strip.move(EDGE, BOTTOM);
    strip.advance(SETTLE_MS + 50);
    expect(strip.events).toEqual(["start", "speed_slow", "speed_fast"]);
  });

  it("shows notches in the mode's unit from the start", () => {
    const labels = (auto: AutoMode) => [...auto.element.querySelectorAll(".notch-label")].map((l) => l.textContent);
    expect(labels(setup().auto)).toEqual(["2s", "2s", "5s", "5s", "10s", "10s"]);
    expect(labels(setup({ mode: "strip" }).auto)).toEqual(["0.5×", "0.5×", "1×", "1×", "2×", "2×", "4×", "4×"]);
  });

  it("freezes and pulses the gauge when locked", () => {
    const { auto, advance, move } = setup({ mode: "strip" });
    move(EDGE, BOTTOM);
    advance(300);
    auto.toggleLock();
    const height = auto.element.querySelector<HTMLElement>(".gauge")!.style.height;
    move(EDGE, MIDDLE + 70);
    advance(500);
    expect(auto.element.classList.contains("locked")).toBe(true);
    expect(getComputedStyle(auto.element.querySelector(".lock-icon")!).display).not.toBe("none");
    expect(auto.element.querySelector<HTMLElement>(".gauge")!.style.height).toBe(height);
  });

  it("scrolls the strip at the height's speed, without draining, and stops at the bottom", () => {
    const { auto, events, advance, move, scrolled, gauge } = setup({ mode: "strip", scrollRoom: 3000 });
    move(EDGE, BOTTOM);
    advance(DWELL_MS + 16);
    const before = scrolled();
    const height = gauge().style.height;
    advance(1000);
    expect(scrolled() - before).toBeCloseTo(STRIP_PX_PER_SECOND * MAX_SPEED, -2);
    expect(gauge().style.height).toBe(height);
    advance(5000);
    expect(auto.state).toBe("idle");
    expect(events.at(-1)).toBe("end");
  });

  it("reports the speed for the pill, and null once stopped", () => {
    const { speeds, advance, move } = setup({ mode: "strip" });
    move(EDGE, BOTTOM);
    advance(300);
    move(OUTSIDE, BOTTOM);
    // The track's last pixel is just short of its end, so just short of the top speed.
    expect(speeds[0]).toMatchObject({ direction: 1, locked: false });
    expect(speeds[0]!.multiplier).toBeGreaterThan(MAX_SPEED - 0.1);
    expect(speeds.at(-1)).toBeNull();
  });

  it("stops without a message when the reader asks", () => {
    const { auto, events, advance, move } = setup();
    move(EDGE, BOTTOM);
    advance(300);
    auto.stopSilently();
    expect(auto.state).toBe("idle");
    expect(events).toEqual(["start"]);
  });

  it("keeps running when the cursor overshoots the track's ends in its column, at the end's speed", () => {
    const { auto, speeds, advance, move } = setup({ mode: "strip" });
    move(EDGE, BOTTOM);
    advance(300);
    move(EDGE, BOTTOM + 150);
    advance(100);
    expect(auto.state).toBe("running");
    expect(speeds.at(-1)).toMatchObject({ multiplier: MAX_SPEED, direction: 1 }); // overshoot holds the very end
    move(EDGE + 40, BOTTOM + 150); // out of the column
    expect(auto.state).toBe("idle");
  });

  it("doesn't start from just above or below the track", () => {
    const { events, advance, move } = setup();
    move(EDGE, BOTTOM + 30);
    advance(1000);
    move(EDGE, BOX.top + 5); // the grab bar
    advance(1000);
    expect(events).toEqual([]);
  });

  it("reports the lock, so it can be shown", () => {
    const { auto, speeds, advance, move } = setup();
    move(EDGE, TOP);
    advance(300);
    auto.toggleLock();
    expect(speeds.at(-1)).toEqual({ multiplier: speedAt(0, PILL.track, "page").multiplier, direction: -1, locked: true });
  });
});

describe("AutoMode pill", () => {
  const grab = (auto: AutoMode) => auto.element.querySelector<HTMLElement>(".auto-grab")!;
  const pointer = (el: Element, type: string, x: number, y: number) =>
    el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true, cancelable: true }));

  it("sits clear of the right edge by default", () => {
    const { auto } = setup();
    expect(auto.box.left + auto.box.width).toBe(VIEW.width - PILL.margin);
    expect(auto.element.style.left).toBe(`${BOX.left}px`);
  });

  it("ends in a flat cap reading AUTO below its full track, which moves it too", () => {
    const { auto, moves } = setup();
    const parts = [...auto.element.children].map((c) => c.className);
    expect(parts).toEqual(["auto-grab", "auto-track", "auto-cap"]);
    const cap = auto.element.querySelector<HTMLElement>(".auto-cap")!;
    expect(cap.textContent).toBe("AUTO");
    expect([cap.style.height, auto.element.querySelector<HTMLElement>(".auto-track")!.style.height]).toEqual([`${PILL.cap}px`, `${PILL.track}px`]);
    expect(auto.box.height).toBe(PILL.grab + PILL.track + PILL.cap);
    const capTop = BOX.top + PILL.grab + PILL.track + 5;
    pointer(cap, "pointerdown", BOX.left + 10, capTop);
    pointer(cap, "pointermove", 110, capTop + 20);
    pointer(cap, "pointerup", 110, capTop + 20);
    expect(moves).toHaveLength(1);
    expect(auto.box.left).toBe(100);
  });

  it("moves by its grab bar, saves where it went, and never starts while dragged", () => {
    const { auto, events, advance, move, moves } = setup();
    pointer(grab(auto), "pointerdown", BOX.left + 10, BOX.top + 5);
    expect(auto.dragging).toBe(true);
    pointer(grab(auto), "pointermove", 110, 105);
    move(110, 300); // over where the track is now
    advance(1000);
    pointer(grab(auto), "pointerup", 110, 105);
    expect(auto.box).toMatchObject({ left: 100, top: 100 });
    expect(events).toEqual([]);
    expect(moves).toHaveLength(1);
    move(110, 300); // still resting on the track after the drop: it has to leave first
    advance(1000);
    expect(events).toEqual([]);
  });

  it("stops a running session when dragged, but keeps a locked one going", () => {
    const a = setup();
    a.move(EDGE, BOTTOM);
    a.advance(300);
    pointer(grab(a.auto), "pointerdown", EDGE, BOX.top + 5);
    expect(a.auto.state).toBe("idle");
    expect(a.events).toEqual(["start"]);

    const b = setup();
    b.move(EDGE, BOTTOM);
    b.advance(300);
    b.auto.toggleLock();
    pointer(grab(b.auto), "pointerdown", EDGE, BOX.top + 5);
    pointer(grab(b.auto), "pointermove", 200, 200);
    pointer(grab(b.auto), "pointerup", 200, 200);
    expect(b.auto.state).toBe("locked");
  });

  it("can't be dragged out of the viewport, and stays inside when it shrinks", () => {
    const { auto, resize } = setup();
    pointer(grab(auto), "pointerdown", BOX.left + 10, BOX.top + 5);
    pointer(grab(auto), "pointermove", 5000, 5000);
    pointer(grab(auto), "pointerup", 5000, 5000);
    expect(auto.box.left + auto.box.width).toBe(VIEW.width);
    expect(auto.box.top + auto.box.height).toBe(VIEW.height);
    resize(500, 400);
    expect(auto.box.left + auto.box.width).toBe(500);
    expect(auto.box.top + auto.box.height).toBe(400);
  });
});
