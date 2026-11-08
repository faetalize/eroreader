// The auto zone's speed: the cursor's height in the zone sets direction and speed.

// The zone is a small pill: the speed track between two flat caps, a grab bar on top and one
// reading AUTO at the bottom (which moves it too), so the track is usable to its very ends.
export const PILL = {
  width: 56, // room for the notch labels over the liquid
  grab: 30, // tall enough to grab without aiming
  cap: 22,
  track: 320, // about 141 px of travel each side, past the dead zone's edge
  margin: 40, // default distance from the right edge, clear of the scrollbar
};
export const NEAR_ZONE = 60; // px around the pill where it starts to glow
export const DWELL_MS = 250; // on the track this long before hands-free starts
export const DEAD_ZONE = 0.06; // of the track's height, either side of the middle
export const SETTLE_MS = 700; // in a range this long before it counts

// Both modes measure from the dead zone's edge, so the dead zone never eats into the range.
// `reach` is how far past that edge the cursor is: 0 to about 141 px on a 320 px track.

// Strip mode: further is faster, from 0× at the edge to 4× at the ends, on a curve that gets
// steeper toward the ends for fine control at low speeds. 1× is 300 px/s.
export const MAX_SPEED = 4;
export const STRIP_PX_PER_SECOND = 300;
export const SLOW_BELOW = 0.75;
export const FAST_ABOVE = 2;

// Page mode: the reach is how much liquid there is, and it drains at a constant pace, so
// further is longer until the page turns: every 12 px is a second, about 11.7 s at the ends.
// 0.5 s is the floor, so pages can't flip absurdly fast. Pace is measured against a page
// every 5 s; 2 s a page or less counts as fast, slower than 0.75× (6.7 s) as slow.
export const DRAIN_PX_PER_SECOND = 12;
export const MIN_PAGE_SECONDS = 0.5;
export const PAGE_SECONDS = 5;
export const FAST_PAGE_SECONDS = 2;

export type Direction = 1 | -1; // forward (down) or back (up)
export type SpeedRange = "hold" | "slow" | "medium" | "fast";
export type PaceMode = "page" | "strip";

export interface Speed {
  multiplier: number; // pace against 1× (300 px/s, or a page every 5 s); 0 in the dead zone
  direction: Direction;
  range: SpeedRange;
  reach: number; // px past the dead zone's edge, for the gauge
}

export function deadZone(height: number): number {
  return DEAD_ZONE * height;
}

// Travel past the dead zone's edge on each side.
export function travel(height: number): number {
  return height / 2 - deadZone(height);
}

export function stripMultiplier(reach: number, height = PILL.track): number {
  const t = Math.min(1, Math.max(0, reach / travel(height)));
  return MAX_SPEED * t * t;
}

export function pageSeconds(reach: number): number {
  return Math.max(MIN_PAGE_SECONDS, reach / DRAIN_PX_PER_SECOND);
}

// Speed at height `y` on a track `height` tall, in the given mode.
export function speedAt(y: number, height: number, mode: PaceMode = "strip"): Speed {
  const offset = y - height / 2;
  const direction: Direction = offset < 0 ? -1 : 1;
  const past = Math.abs(offset) - deadZone(height);
  if (past <= 0) return { multiplier: 0, direction, range: "hold", reach: 0 };
  const reach = Math.min(travel(height), past);
  if (mode === "page") return pageSpeed(pageSeconds(reach), reach, direction);
  return stripSpeed(stripMultiplier(reach, height), reach, direction);
}

function pageSpeed(seconds: number, reach: number, direction: Direction): Speed {
  const range = seconds <= FAST_PAGE_SECONDS ? "fast" : seconds > PAGE_SECONDS / SLOW_BELOW ? "slow" : "medium";
  return { multiplier: PAGE_SECONDS / seconds, direction, range, reach };
}

function stripSpeed(multiplier: number, reach: number, direction: Direction): Speed {
  const range = multiplier < SLOW_BELOW ? "slow" : multiplier > FAST_ABOVE ? "fast" : "medium";
  return { multiplier, direction, range, reach };
}

// A pace in the unit the pill shows for the mode: seconds per page, or the scroll speed
// multiplier. Within what the track reaches.
export const PAGE_SECONDS_RANGE = { min: MIN_PAGE_SECONDS, max: Math.floor((travel(PILL.track) / DRAIN_PX_PER_SECOND) * 10) / 10 };
export const STRIP_SPEED_RANGE = { min: 0.1, max: MAX_SPEED };

// The forward speed for a pace, as if the cursor were where it gives that pace.
export function speedFor(mode: PaceMode, pace: number): Speed {
  if (mode === "page") {
    const seconds = Math.min(PAGE_SECONDS_RANGE.max, Math.max(PAGE_SECONDS_RANGE.min, pace));
    return pageSpeed(seconds, seconds * DRAIN_PX_PER_SECOND, 1);
  }
  const multiplier = Math.min(STRIP_SPEED_RANGE.max, Math.max(STRIP_SPEED_RANGE.min, pace));
  return stripSpeed(multiplier, Math.sqrt(multiplier / MAX_SPEED) * travel(PILL.track), 1);
}

// The pace a speed runs at, in the mode's unit, to two decimal places.
export function paceOf(mode: PaceMode, speed: Speed): number {
  const pace = mode === "page" ? pageSeconds(speed.reach) : speed.multiplier;
  return Math.round(pace * 100) / 100;
}

export interface Notch {
  offset: number; // px from the track's middle, on both halves
  label: string | null;
  major: boolean;
}

// Graduations from the dead zone's edge, in the unit that matters: seconds per page in page
// mode, speed in strip mode.
export function notches(mode: PaceMode, height = PILL.track): Notch[] {
  const dead = deadZone(height);
  const room = travel(height);
  if (mode === "page") {
    const out: Notch[] = [];
    for (let seconds = 0; seconds * DRAIN_PX_PER_SECOND <= room; seconds++) {
      const label = [2, 5, 10].includes(seconds) ? `${seconds}s` : null;
      out.push({ offset: dead + seconds * DRAIN_PX_PER_SECOND, label, major: label !== null || seconds === 0 });
    }
    return out;
  }
  const labelled = new Set([0.5, 1, 2, 4]);
  return [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((speed) => {
    const label = labelled.has(speed) ? `${speed}×` : null;
    return { offset: dead + Math.sqrt(speed / MAX_SPEED) * room, label, major: label !== null || speed === 0 };
  });
}

export interface Settled {
  range: SpeedRange;
  direction: Direction;
}

// Reports a range (and direction) once the speed has stayed in it for SETTLE_MS, so passing
// through a range on the way to another doesn't count. Reports each settled state once.
export class Settler {
  #candidate: Settled;
  #since: number;
  #committed: Settled;

  constructor(initial: Settled, now: number) {
    this.#candidate = { ...initial };
    this.#committed = { ...initial };
    this.#since = now;
  }

  get committed(): Settled {
    return { ...this.#committed };
  }

  // Returns the newly settled state, or null.
  update(state: Settled, now: number): Settled | null {
    if (state.range !== this.#candidate.range || state.direction !== this.#candidate.direction) {
      this.#candidate = { ...state };
      this.#since = now;
    }
    const same = this.#candidate.range === this.#committed.range && this.#candidate.direction === this.#committed.direction;
    if (same || now - this.#since < SETTLE_MS) return null;
    this.#committed = { ...this.#candidate };
    return { ...this.#committed };
  }
}

// The `{speed}` value: an arrow for the direction, then the multiplier.
export function formatSpeed(multiplier: number, direction: Direction): string {
  if (multiplier === 0) return "0.0";
  return `${direction === 1 ? "↓" : "↑"}${multiplier.toFixed(1)}`;
}

export interface PillPosition {
  x: number; // share of the free space to the left of the pill, 0 to 1
  y: number; // share of the free space above it
}

export interface PillBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function pillSize(): { width: number; height: number } {
  return { width: PILL.width, height: PILL.grab + PILL.track + PILL.cap };
}

// Where the pill sits: the saved position, or by default near the right edge with the track
// centered vertically. Always inside the viewport.
export function placePill(viewport: { width: number; height: number }, saved: PillPosition | null): PillBox {
  const { width, height } = pillSize();
  const freeX = Math.max(0, viewport.width - width);
  const freeY = Math.max(0, viewport.height - height);
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const left = saved ? clamp01(saved.x) * freeX : Math.max(0, viewport.width - width - PILL.margin);
  const top = saved ? clamp01(saved.y) * freeY : Math.max(0, viewport.height / 2 - PILL.grab - PILL.track / 2);
  return { left: Math.round(Math.min(left, freeX)), top: Math.round(Math.min(top, freeY)), width, height };
}

export function positionOf(left: number, top: number, viewport: { width: number; height: number }): PillPosition {
  const { width, height } = pillSize();
  const freeX = viewport.width - width;
  const freeY = viewport.height - height;
  return { x: freeX > 0 ? Math.min(1, Math.max(0, left / freeX)) : 0, y: freeY > 0 ? Math.min(1, Math.max(0, top / freeY)) : 0 };
}
