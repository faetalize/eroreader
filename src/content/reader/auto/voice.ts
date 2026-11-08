// A character's messages in hands-free mode: a toast that fades in, then shrinks to a pill in
// the corner that shows the pill template while hands-free runs. Only made when a character
// file is loaded.
import type { SpeedReport } from "./autoMode";
import { lockIcon } from "./icons";
import { fillPlaceholders, splitActions, type AutoEvent, type MessagePicker, type RecentLines } from "./messages";
import { formatSpeed } from "./speed";

// At most one toast this often; `end` always shows.
export const MIN_GAP_MS = 10_000;

// Long enough to read: a base plus a little per character, capped.
export function toastDuration(line: string): number {
  return Math.min(8000, 2500 + 45 * line.length);
}

export interface VoiceSession {
  recent(): Promise<RecentLines>;
  saveRecent(recent: RecentLines): void;
  finish(gid: number): Promise<number>; // marks the gallery finished this session; returns the count
}

export interface VoiceDeps {
  doc: Document;
  picker: MessagePicker;
  session: VoiceSession;
  gid: number;
  now?: () => Date;
  clock?: () => number;
}

export class Voice {
  readonly element: HTMLDivElement;
  readonly #deps: VoiceDeps;
  readonly #clock: () => number;
  #lastToast = -Infinity;
  #speed: SpeedReport | null = null; // null when hands-free isn't running
  #toastTimer: ReturnType<typeof setTimeout> | null = null;
  #toasting = false;

  constructor(deps: VoiceDeps) {
    this.#deps = deps;
    this.#clock = deps.clock ?? (() => performance.now());
    this.element = deps.doc.createElement("div");
    this.element.className = "voice";
    this.element.hidden = true;
    this.element.setAttribute("role", "status");
    void deps.session.recent().then(
      (recent) => deps.picker.setRecent(recent),
      () => {},
    );
  }

  get text(): string {
    return this.element.hidden ? "" : (this.element.textContent ?? "");
  }

  get locked(): boolean {
    return !this.element.hidden && this.element.querySelector(".lock-icon") !== null;
  }

  get showingToast(): boolean {
    return this.#toasting;
  }

  event(event: AutoEvent): void {
    const now = this.#clock();
    if (event !== "end" && now - this.#lastToast < MIN_GAP_MS) return; // never pile up
    this.#lastToast = now;
    if (event === "end") {
      void this.#deps.session.finish(this.#deps.gid).then(
        (count) => this.#say(event, count),
        () => this.#say(event, 1),
      );
    } else {
      this.#say(event, 0);
    }
  }

  // The current speed while hands-free runs, or null once it stops.
  speed(speed: SpeedReport | null): void {
    this.#speed = speed;
    if (this.#toasting) return;
    if (speed === null) this.#hide();
    else this.#showPill();
  }

  destroy(): void {
    if (this.#toastTimer !== null) clearTimeout(this.#toastTimer);
    this.element.remove();
  }

  #say(event: AutoEvent, finishedCount: number): void {
    const pick = this.#deps.picker.pick(event, { now: this.#deps.now?.() ?? new Date(), finishedCount });
    if (!pick) return;
    this.#deps.session.saveRecent(this.#deps.picker.recent);
    const doc = this.#deps.doc;
    this.element.replaceChildren(
      ...splitActions(pick.line).map((segment) => {
        const span = doc.createElement("span");
        span.className = segment.action ? "voice-action" : "voice-spoken";
        span.textContent = segment.text;
        return span;
      }),
    );
    this.element.classList.remove("pill");
    this.element.classList.add("toast");
    this.element.hidden = false;
    this.#toasting = true;
    if (this.#toastTimer !== null) clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => {
      this.#toastTimer = null;
      this.#toasting = false;
      if (this.#speed === null) this.#hide();
      else this.#showPill();
    }, toastDuration(pick.line));
  }

  #showPill(): void {
    const speed = this.#speed;
    if (!this.#deps.picker.pill) {
      this.#hide(); // a character without a pill template
      return;
    }
    this.element.classList.remove("toast");
    this.element.classList.add("pill");
    const text = fillPlaceholders(this.#deps.picker.pill, { speed: speed ? formatSpeed(speed.multiplier, speed.direction) : "0.0" });
    this.element.replaceChildren(...(speed?.locked ? [lockIcon(this.#deps.doc)] : []), text);
    this.element.hidden = false;
  }

  #hide(): void {
    this.element.hidden = true;
    this.element.classList.remove("toast", "pill");
  }
}
