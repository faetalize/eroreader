// Picks a character's lines for hands-free mode's events. The character file (see
// shared/character.ts) is the only source of message text: this module only chooses among
// its lines and fills in placeholders.
//
// The file is JSON: `pill`, a template shown while hands-free runs ({speed} is filled in);
// `events`, lists of lines per event (AUTO_EVENTS, plus `late_night` and `finished_count`
// variants); and `rare`, occasional replacements per event. Text between *asterisks* is an
// action, shown apart from what's said. {count} becomes how many galleries were finished in
// this browser session, written out ("third").

export const AUTO_EVENTS = [
  "start",
  "locked",
  "stopped",
  "speed_slow",
  "speed_fast",
  "speed_hold",
  "reverse",
  "halfway",
  "almost_end",
  "end",
] as const;

export type AutoEvent = (typeof AUTO_EVENTS)[number];

export interface MessagesFile {
  pill: string;
  events: Record<string, string[]>;
  rare: Record<string, string[]>;
}

// Reads the parts of the file the engine uses, tolerating missing pools.
export function readMessages(value: unknown): MessagesFile {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const pools = (v: unknown) => {
    const out: Record<string, string[]> = {};
    if (typeof v === "object" && v !== null) {
      for (const [key, lines] of Object.entries(v)) {
        if (Array.isArray(lines)) out[key] = lines.filter((line): line is string => typeof line === "string" && line.length > 0);
      }
    }
    return out;
  };
  return { pill: typeof raw.pill === "string" ? raw.pill : "", events: pools(raw.events), rare: pools(raw.rare) };
}

export const RARE_CHANCE = 0.05;
export const RECENT_SIZE = 3; // lines not repeated, per pool (fewer for small pools)
export const LATE_NIGHT = { from: 23, to: 5 }; // local hours

export function isLateNight(date: Date): boolean {
  const hour = date.getHours();
  return hour >= LATE_NIGHT.from || hour < LATE_NIGHT.to;
}

const ONES = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const TENS_ORDINAL = ["", "", "twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth"];

// "second", "twenty-first", … for {count}. Past 99, digits with a suffix.
export function ordinalWord(n: number): string {
  if (n >= 1 && n < 20) return ONES[n]!;
  if (n >= 20 && n < 100) {
    const tens = Math.floor(n / 10);
    return n % 10 === 0 ? TENS_ORDINAL[tens]! : `${TENS[tens]}-${ONES[n % 10]}`;
  }
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

// `speed` comes formatted (see formatSpeed), e.g. "↓1.2".
export function fillPlaceholders(line: string, values: { count?: number; speed?: string }): string {
  return line
    .replaceAll("{count}", values.count === undefined ? "{count}" : ordinalWord(values.count))
    .replaceAll("{speed}", values.speed ?? "{speed}");
}

export interface Segment {
  text: string;
  action: boolean; // between *...*: shown without the asterisks, in another color
}

// Text inside each *...* pair is an action; the rest is spoken. Spacing stays as written.
// With an unmatched asterisk, the whole line is spoken text.
export function splitActions(line: string): Segment[] {
  const parts = line.split("*");
  if (parts.length % 2 === 0) return [{ text: line, action: false }];
  return parts.map((text, i) => ({ text, action: i % 2 === 1 })).filter((segment) => segment.text.trim() !== "");
}

export interface PickContext {
  now: Date;
  finishedCount: number; // galleries finished this session, this one included
}

// Lines recently shown, per pool, kept for the whole browser session.
export type RecentLines = Record<string, string[]>;

export interface Pick {
  pool: string; // e.g. "start", "late_night", "rare.end"
  line: string; // placeholders filled
}

export class MessagePicker {
  readonly #file: MessagesFile;
  readonly #random: () => number;
  #recent: RecentLines;

  constructor(file: MessagesFile, recent: RecentLines = {}, random: () => number = Math.random) {
    this.#file = file;
    this.#recent = structuredClone(recent);
    this.#random = random;
  }

  get recent(): RecentLines {
    return structuredClone(this.#recent);
  }

  setRecent(recent: RecentLines): void {
    this.#recent = structuredClone(recent);
  }

  get pill(): string {
    return this.#file.pill;
  }

  // A rare line replaces the regular one with a small chance; then late_night replaces a
  // start late at night, and finished_count replaces an end after more than one finished
  // gallery this session.
  pick(event: AutoEvent, context: PickContext): Pick | null {
    const { events, rare } = this.#file;
    let pool: string = event;
    let lines = events[event] ?? [];
    const rareLines = rare[event] ?? [];
    if (rareLines.length > 0 && this.#random() < RARE_CHANCE) {
      pool = `rare.${event}`;
      lines = rareLines;
    } else if (event === "start" && isLateNight(context.now) && events.late_night?.length) {
      pool = "late_night";
      lines = events.late_night;
    } else if (event === "end" && context.finishedCount > 1 && events.finished_count?.length) {
      pool = "finished_count";
      lines = events.finished_count;
    }
    if (lines.length === 0) return null;

    const avoid = new Set((this.#recent[pool] ?? []).slice(-Math.min(RECENT_SIZE, lines.length - 1)));
    const choices = lines.filter((line) => !avoid.has(line));
    const line = choices[Math.floor(this.#random() * choices.length)] ?? choices[0]!;
    this.#recent[pool] = [...(this.#recent[pool] ?? []).filter((l) => l !== line), line].slice(-RECENT_SIZE);
    return { pool, line: fillPlaceholders(line, { count: context.finishedCount }) };
  }
}
