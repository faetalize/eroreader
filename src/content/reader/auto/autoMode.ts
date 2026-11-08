// Hands-free mode: the auto zone pill, auto-scroll in strip mode and auto-advance in page
// mode, and the liquid gauge.
import { lockIcon } from "./icons";
import type { AutoEvent } from "./messages";
import {
  DEAD_ZONE,
  DWELL_MS,
  NEAR_ZONE,
  notches,
  paceOf,
  PAGE_SECONDS,
  PILL,
  placePill,
  positionOf,
  Settler,
  speedAt,
  STRIP_PX_PER_SECOND,
  type Direction,
  type PillBox,
  type PaceMode,
  type PillPosition,
  type Speed,
} from "./speed";

export type AutoState = "idle" | "dwelling" | "running" | "locked";

export interface SpeedReport {
  multiplier: number;
  direction: Direction;
  locked: boolean;
}

export interface AutoModeDeps {
  doc: Document;
  mode: () => "page" | "strip";
  viewport: () => { width: number; height: number };
  position: () => PillPosition | null; // where the pill was dragged, if it was
  onMove: (position: PillPosition) => void; // the pill was dragged somewhere new
  // Page mode: one page (or spread) forward or back; false when there's nowhere to go.
  step: (direction: Direction) => boolean;
  // Strip mode: scrolls by `dy` px; false when it can't go further that way.
  scrollBy: (dy: number) => boolean;
  atLastPage: () => boolean;
  emit: (event: AutoEvent) => void;
  onSpeed: (speed: SpeedReport | null) => void; // null once stopped
  onLastPace?: (mode: PaceMode, pace: number) => void; // the pace a session ran at, once it stops
  now?: () => number;
  requestFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

// A long gap between frames (a background tab) counts as this much, so nothing jumps.
const MAX_FRAME_MS = 100;

export class AutoMode {
  readonly element: HTMLDivElement; // the pill: grab bar and track
  readonly #grab: HTMLDivElement;
  readonly #cap: HTMLDivElement;
  readonly #gauge: HTMLDivElement;
  readonly #scale: HTMLDivElement;
  readonly #deps: AutoModeDeps;
  readonly #now: () => number;
  #box: PillBox;
  #state: AutoState = "idle";
  #mustLeave = false; // after a stop, the cursor leaves the track before it can start again
  #onTrack = false;
  #pointer: Speed | null = null;
  #locked: Speed | null = null;
  #runMode: PaceMode = "page"; // the reading mode the session started in
  #dragging: { pointerId: number; dx: number; dy: number } | null = null;
  #dwellSince = 0;
  #settler: Settler | null = null;
  #progress = 0; // page mode: share of the countdown to the next page that has run
  #frame = 0;
  #lastTick = 0;
  #reported = "";
  #scaleMode: PaceMode | null = null;
  #lastPage = 0;
  #halfwayFired = false;
  #almostEndFired = false;

  constructor(deps: AutoModeDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => performance.now());
    const doc = deps.doc;
    this.element = doc.createElement("div");
    this.element.className = "auto-zone";
    this.#grab = doc.createElement("div");
    this.#grab.className = "auto-grab";
    this.#grab.title = "Drag to move";
    this.#grab.style.height = `${PILL.grab}px`;
    const track = doc.createElement("div");
    track.className = "auto-track";
    track.style.height = `${PILL.track}px`;
    this.#cap = doc.createElement("div");
    this.#cap.className = "auto-cap";
    this.#cap.title = "Drag to move";
    this.#cap.style.height = `${PILL.cap}px`;
    this.#cap.textContent = "AUTO";
    const dead = doc.createElement("div");
    dead.className = "auto-dead";
    dead.style.top = `${PILL.track / 2 - DEAD_ZONE * PILL.track}px`;
    dead.style.height = `${2 * DEAD_ZONE * PILL.track}px`;
    this.#gauge = doc.createElement("div");
    this.#gauge.className = "gauge";
    this.#scale = doc.createElement("div");
    this.#scale.className = "auto-scale";
    const lock = lockIcon(doc);
    track.append(dead, this.#gauge, this.#scale, lock);
    this.element.append(this.#grab, track, this.#cap);
    this.#box = placePill(deps.viewport(), deps.position());
    this.#place();
    this.#render();
    this.#attachDrag();
  }

  get state(): AutoState {
    return this.#state;
  }

  get active(): boolean {
    return this.#state === "running" || this.#state === "locked";
  }

  get box(): PillBox {
    return { ...this.#box };
  }

  get dragging(): boolean {
    return this.#dragging !== null;
  }

  // The reader switched between page and strip mode: stop, and show the new mode's notches.
  modeChanged(): void {
    this.stopSilently();
    this.#render();
  }

  // Keeps the pill inside a resized viewport.
  layout(): void {
    this.#box = placePill(this.#deps.viewport(), this.#deps.position());
    this.#place();
  }

  // The cursor moved, in viewport coordinates. `overUi`: it's over the toolbar, filmstrip or
  // another control.
  pointer(x: number, y: number, overUi: boolean, buttons: number): void {
    if (this.#dragging) return; // dragging never starts anything
    const box = this.#box;
    const trackTop = box.top + PILL.grab;
    const inColumn = x >= box.left && x < box.left + box.width;
    const onTrack = !overUi && buttons === 0 && inColumn && y >= trackTop && y < trackTop + PILL.track;
    this.#onTrack = onTrack;
    const near = !overUi && x >= box.left - NEAR_ZONE && x < box.left + box.width + NEAR_ZONE && y >= box.top - NEAR_ZONE && y < box.top + box.height + NEAR_ZONE;
    this.element.classList.toggle("near", near);
    if (!onTrack) this.#mustLeave = false;
    // While running the cursor may overshoot the track's ends in its column: the speed holds
    // at the end's value, as it did when the zone ran the full height.
    if (onTrack || (this.#state === "running" && inColumn)) {
      this.#pointer = speedAt(Math.min(PILL.track, Math.max(0, y - trackTop)), PILL.track, this.#deps.mode());
    }

    switch (this.#state) {
      case "idle":
        if (onTrack && !this.#mustLeave) {
          this.#state = "dwelling";
          this.#dwellSince = this.#now();
          this.#loop();
        }
        break;
      case "dwelling":
        if (!onTrack) this.#state = "idle";
        break;
      case "running":
        if (!inColumn) this.#stop("stopped");
        break;
      case "locked":
        break; // keeps going wherever the cursor is
    }
    this.#render();
  }

  // The cursor left the window, or the window lost focus: a run steered on the pill ends, as
  // when the cursor leaves the pill. A locked one keeps going: it needs no cursor.
  leaveWindow(): void {
    this.element.classList.remove("near");
    this.#onTrack = false;
    this.#mustLeave = false;
    if (this.#state === "running") this.#stop("stopped");
    else if (this.#state === "dwelling") this.#state = "idle";
  }

  // Locks the current speed while steering, or stops when already locked. Returns whether it did
  // either.
  toggleLock(): boolean {
    if (this.#state === "running") {
      this.#state = "locked";
      this.#locked = this.#pointer;
      this.#report(true);
      this.#deps.emit("locked");
      this.#render();
      return true;
    }
    if (this.#state === "locked") {
      this.#stop("stopped");
      return true;
    }
    return false;
  }

  // Esc: always stops. Returns whether it used the key.
  escape(): boolean {
    if (this.active) {
      this.#stop("stopped");
      return true;
    }
    if (this.#state === "dwelling") {
      this.#stop(null);
      return true;
    }
    return false;
  }

  // Stops without a message: the reader switched mode, hid, closed or covered the zone.
  stopSilently(): void {
    if (this.#state !== "idle") this.#stop(null);
  }

  // The last page on screen changed, whoever turned it. A page turned by hand restarts the
  // countdown on the page landed on, as an automatic turn does.
  pageShown(page: number, pageCount: number): void {
    const previous = this.#lastPage;
    this.#lastPage = page;
    if (page !== previous && this.#progress !== 0) {
      this.#progress = 0;
      this.#render();
    }
    if (!this.active || previous === 0 || page <= previous) return;
    const half = Math.ceil(pageCount / 2);
    if (!this.#halfwayFired && previous < half && page >= half) {
      this.#halfwayFired = true;
      this.#deps.emit("halfway");
    }
    const almost = pageCount - 2;
    if (!this.#almostEndFired && page < pageCount && previous < almost && page >= almost) {
      this.#almostEndFired = true;
      this.#deps.emit("almost_end");
    }
  }

  destroy(): void {
    this.stopSilently();
    if (this.#frame) (this.#deps.cancelFrame ?? cancelAnimationFrame)(this.#frame);
    this.#frame = 0;
    this.element.remove();
  }

  #place(): void {
    this.element.style.left = `${this.#box.left}px`;
    this.element.style.top = `${this.#box.top}px`;
    this.element.style.width = `${this.#box.width}px`;
    this.element.style.height = `${this.#box.height}px`;
  }

  // Either cap moves the pill. A running session stops, since the cursor no longer sets its
  // speed; a locked one keeps going.
  #attachDrag(): void {
    for (const handle of [this.#grab, this.#cap]) {
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (this.#state === "running" || this.#state === "dwelling") this.#stop(null);
        this.#dragging = { pointerId: event.pointerId, dx: event.clientX - this.#box.left, dy: event.clientY - this.#box.top };
        this.element.classList.add("dragging");
        handle.setPointerCapture?.(event.pointerId);
      });
      handle.addEventListener("pointermove", (event) => {
        const drag = this.#dragging;
        if (!drag || event.pointerId !== drag.pointerId) return;
        const viewport = this.#deps.viewport();
        this.#box = placePill(viewport, positionOf(event.clientX - drag.dx, event.clientY - drag.dy, viewport));
        this.#place();
      });
      const end = (event: PointerEvent) => {
        const drag = this.#dragging;
        if (!drag || event.pointerId !== drag.pointerId) return;
        this.#dragging = null;
        this.element.classList.remove("dragging");
        this.#mustLeave = true;
        this.#deps.onMove(positionOf(this.#box.left, this.#box.top, this.#deps.viewport()));
      };
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    }
  }

  #speed(): Speed | null {
    return this.#state === "locked" ? this.#locked : this.#pointer;
  }

  // Starts locked at `speed`, as if it had been set on the track and locked. False when it's
  // already running.
  startLocked(speed: Speed): boolean {
    if (this.active || this.#dragging) return false;
    this.#state = "locked";
    this.#runMode = this.#deps.mode();
    this.#locked = speed;
    this.#progress = 0;
    this.#settler = null;
    this.#deps.emit("start");
    this.#report(true);
    this.#loop();
    this.#render();
    return true;
  }

  // Stops a running session, saying so. False when there's none.
  stop(): boolean {
    if (!this.active) return false;
    this.#stop("stopped");
    return true;
  }

  #start(): void {
    const speed = this.#pointer!;
    this.#state = "running";
    this.#runMode = this.#deps.mode();
    this.#progress = 0;
    // Starting with the cursor already in the upper half is just a start, not a reverse.
    this.#settler = new Settler({ range: speed.range, direction: speed.direction }, this.#now());
    this.#deps.emit("start");
  }

  #stop(event: AutoEvent | null): void {
    const wasActive = this.active;
    const speed = wasActive ? this.#speed() : null;
    // In the mode it ran in: a mode change stops it after the switch.
    if (speed && speed.multiplier > 0) this.#deps.onLastPace?.(this.#runMode, paceOf(this.#runMode, speed));
    this.#state = "idle";
    this.#locked = null;
    this.#progress = 0;
    this.#settler = null;
    this.#mustLeave = this.#onTrack;
    if (this.#reported !== "" || wasActive) {
      this.#reported = "";
      this.#deps.onSpeed(null);
    }
    this.#render();
    if (event) this.#deps.emit(event);
  }

  // Tells the voice when the shown speed, direction or lock changes.
  #report(force = false): void {
    const speed = this.#speed();
    if (!speed) return;
    const locked = this.#state === "locked";
    const key = `${speed.multiplier.toFixed(1)}|${speed.direction}|${locked}`;
    if (!force && key === this.#reported) return;
    this.#reported = key;
    this.#deps.onSpeed({ multiplier: speed.multiplier, direction: speed.direction, locked });
  }

  #loop(): void {
    if (this.#frame) return;
    this.#lastTick = this.#now();
    const frame = this.#deps.requestFrame ?? requestAnimationFrame;
    const tick = () => {
      this.#frame = 0;
      if (this.#state === "idle") return;
      const now = this.#now();
      const dt = Math.min(MAX_FRAME_MS, now - this.#lastTick);
      this.#lastTick = now;
      this.#tick(now, dt);
      if (this.state !== "idle") this.#frame = frame(tick); // #tick may have stopped it
    };
    this.#frame = frame(tick);
  }

  #tick(now: number, dt: number): void {
    if (this.#state === "dwelling") {
      if (now - this.#dwellSince < DWELL_MS) return;
      this.#start();
    }
    const speed = this.#speed();
    if (!speed) return;

    if (this.#state === "running" && this.#settler) {
      const before = this.#settler.committed;
      const settled = this.#settler.update({ range: speed.range, direction: speed.direction }, now);
      if (settled) {
        if (settled.direction === -1 && before.direction === 1) this.#deps.emit("reverse");
        else if (settled.range === "hold") this.#deps.emit("speed_hold");
        else if (settled.range === "slow") this.#deps.emit("speed_slow");
        else if (settled.range === "fast") this.#deps.emit("speed_fast");
      }
    }
    this.#report();

    if (speed.multiplier > 0) {
      if (this.#deps.mode() === "strip") {
        const moved = this.#deps.scrollBy((speed.direction * speed.multiplier * STRIP_PX_PER_SECOND * dt) / 1000);
        if (!moved) {
          this.#stop(speed.direction === 1 ? "end" : "stopped");
          return;
        }
      } else {
        this.#progress += (dt / 1000) * (speed.multiplier / PAGE_SECONDS); // 1 / seconds per page
        if (this.#progress >= 1) {
          this.#progress = 0;
          const moved = this.#deps.step(speed.direction);
          if (!moved || (speed.direction === 1 && this.#deps.atLastPage())) {
            this.#stop(speed.direction === 1 ? "end" : "stopped");
            return;
          }
        }
      }
    }
    this.#render();
  }

  // The notches, in the current mode's unit.
  #renderScale(): void {
    const mode = this.#deps.mode();
    if (mode === this.#scaleMode) return;
    this.#scaleMode = mode;
    const doc = this.#deps.doc;
    const middle = PILL.track / 2;
    const marks: HTMLElement[] = [];
    for (const notch of notches(mode)) {
      for (const side of [-1, 1]) {
        const y = middle + side * notch.offset;
        const tick = doc.createElement("div");
        tick.className = notch.major ? "tick major" : "tick";
        tick.style.top = `${y}px`;
        marks.push(tick);
        if (notch.label) {
          const label = doc.createElement("span");
          label.className = "notch-label";
          label.textContent = notch.label;
          // The end label sits just inside the track.
          label.style.top = `${Math.min(PILL.track - 7, Math.max(7, y))}px`;
          marks.push(label);
        }
      }
    }
    this.#scale.replaceChildren(...marks);
  }

  // The liquid in the track, filling its width from the dead zone's edge to the cursor. In
  // page mode it drains at a constant pace as the countdown runs; when locked it stops
  // following the cursor and pulses.
  #render(): void {
    this.#renderScale();
    const speed = this.active ? this.#speed() : null;
    this.element.classList.toggle("active", this.active || this.#state === "dwelling");
    this.element.classList.toggle("locked", this.#state === "locked");
    if (!speed) {
      this.#gauge.style.height = "0px";
      return;
    }
    // From the dead zone's edge, like the notches.
    const left = this.#deps.mode() === "page" ? 1 - this.#progress : 1;
    const length = Math.max(0, speed.reach * left);
    const edge = PILL.track / 2 + (speed.direction === 1 ? 1 : -1) * DEAD_ZONE * PILL.track;
    this.#gauge.style.top = `${speed.direction === 1 ? edge : edge - length}px`;
    this.#gauge.style.height = `${length}px`;
  }
}
