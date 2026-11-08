import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTO_EVENTS,
  fillPlaceholders,
  isLateNight,
  MessagePicker,
  ordinalWord,
  RARE_CHANCE,
  readMessages,
  RECENT_SIZE,
  splitActions,
  type MessagesFile,
} from "../src/content/reader/auto/messages";
import { CharacterError, normalizeCharacter, parseCharacter } from "../src/shared/character";

// A small, made-up character, for the tests.
const fileText = readFileSync(join(process.cwd(), "tests/fixtures/character.json"), "utf8");
const sample = parseCharacter(fileText, "Narrator").messages;

// A random source that plays back fixed values.
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};
const day = new Date(2026, 10, 7, 15, 0);
const night = new Date(2026, 10, 7, 1, 30);

describe("character files", () => {
  it("reads a file's pools, the variants and the pill template", () => {
    for (const event of AUTO_EVENTS) expect(sample.events[event]?.length, event).toBeGreaterThan(0);
    expect(sample.events.late_night?.length).toBeGreaterThan(0);
    expect(sample.events.finished_count?.length).toBeGreaterThan(0);
    expect(sample.pill).toContain("{speed}");
  });

  it("names the character after the file, and leaves out what isn't a line", () => {
    const character = parseCharacter(JSON.stringify({ events: { start: ["Go.", 3, ""], extra: "no" }, rare: "no" }), "  My voice ");
    expect(character).toEqual({ name: "My voice", messages: { pill: "", events: { start: ["Go."] }, rare: {} } });
  });

  it("says plainly what's wrong with a file that isn't one", () => {
    const reason = (text: string) => {
      try {
        parseCharacter(text, "x");
        return null;
      } catch (error) {
        return error instanceof CharacterError ? error.message : String(error);
      }
    };
    expect(reason("not json")).toBe("That file isn't a character file.");
    expect(reason("[1, 2]")).toBe("That file isn't a character file.");
    expect(reason('{"events": {"late_night": ["only a variant"]}}')).toBe("That file has no lines for hands-free mode.");
    expect(reason("{}")).toBe("That file has no lines for hands-free mode.");
  });

  it("takes back a stored or restored character only when it's still one", () => {
    const character = parseCharacter(fileText, "Narrator");
    expect(normalizeCharacter(JSON.parse(JSON.stringify(character)))).toEqual(character);
    expect([normalizeCharacter(null), normalizeCharacter({ name: "x" }), normalizeCharacter({ messages: sample })]).toEqual([null, null, null]);
  });
});

describe("MessagePicker", () => {
  const file: MessagesFile = {
    pill: "Narrator · {speed}×",
    events: {
      start: ["s1", "s2", "s3", "s4", "s5"],
      end: ["e1", "e2"],
      late_night: ["n1"],
      finished_count: ["Finished the {count} gallery"],
      reverse: ["r1"],
    },
    rare: { start: ["rare start"], end: ["rare end"] },
  };

  it("picks from the event's pool", () => {
    expect(new MessagePicker(file, {}, sequence(0.9, 0)).pick("start", { now: day, finishedCount: 0 })).toEqual({ pool: "start", line: "s1" });
  });

  it("never repeats the last few lines of a pool", () => {
    const picker = new MessagePicker(file, {}, sequence(0.9, 0));
    const lines = Array.from({ length: 8 }, () => picker.pick("start", { now: day, finishedCount: 0 })!.line);
    for (let i = 1; i < lines.length; i++) {
      expect(lines.slice(Math.max(0, i - RECENT_SIZE), i)).not.toContain(lines[i]);
    }
  });

  it("still works on pools smaller than the memory", () => {
    const picker = new MessagePicker(file, {}, sequence(0.9, 0));
    const lines = Array.from({ length: 4 }, () => picker.pick("end", { now: day, finishedCount: 1 })!.line);
    expect(lines).toEqual(["e1", "e2", "e1", "e2"]);
    expect(new MessagePicker(file, {}, sequence(0.9, 0)).pick("reverse", { now: day, finishedCount: 0 })!.line).toBe("r1");
  });

  it("remembers recent lines across pickers, e.g. across galleries in one session", () => {
    const first = new MessagePicker(file, {}, sequence(0.9, 0));
    first.pick("end", { now: day, finishedCount: 1 });
    const second = new MessagePicker(file, first.recent, sequence(0.9, 0));
    expect(second.pick("end", { now: day, finishedCount: 1 })!.line).toBe("e2");
  });

  it("shows a rare line instead of the regular one with a small chance, even over variants", () => {
    const picker = new MessagePicker(file, {}, sequence(RARE_CHANCE / 2, 0));
    expect(picker.pick("start", { now: night, finishedCount: 0 })).toEqual({ pool: "rare.start", line: "rare start" });
    expect(new MessagePicker(file, {}, sequence(RARE_CHANCE, 0)).pick("start", { now: day, finishedCount: 0 })!.pool).toBe("start");
  });

  it("uses late_night for start late at night", () => {
    const picker = new MessagePicker(file, {}, sequence(0.9, 0));
    expect(picker.pick("start", { now: night, finishedCount: 0 })!.pool).toBe("late_night");
    expect(picker.pick("end", { now: night, finishedCount: 1 })!.pool).toBe("end");
  });

  it("uses finished_count for end once more than one gallery was finished, with the ordinal", () => {
    const picker = new MessagePicker(file, {}, sequence(0.9, 0));
    expect(picker.pick("end", { now: day, finishedCount: 1 })!.pool).toBe("end");
    expect(picker.pick("end", { now: day, finishedCount: 3 })).toEqual({ pool: "finished_count", line: "Finished the third gallery" });
  });

  it("returns nothing for an event without lines", () => {
    expect(new MessagePicker(file).pick("halfway", { now: day, finishedCount: 0 })).toBeNull();
  });

  it("works on a whole character file for every event", () => {
    const picker = new MessagePicker(sample);
    for (const event of AUTO_EVENTS) expect(picker.pick(event, { now: day, finishedCount: 2 })?.line, event).toBeTruthy();
  });
});

describe("helpers", () => {
  it("says late night from 23:00 to 05:00", () => {
    expect([22, 23, 0, 4, 5].map((h) => isLateNight(new Date(2026, 0, 1, h, 30)))).toEqual([false, true, true, true, false]);
  });

  it("writes ordinals as words", () => {
    expect([1, 2, 3, 12, 20, 21, 42, 99, 101, 112].map(ordinalWord)).toEqual([
      "first", "second", "third", "twelfth", "twentieth", "twenty-first", "forty-second", "ninety-ninth", "101st", "112th",
    ]);
  });

  it("fills placeholders", () => {
    expect(fillPlaceholders("Narrator · {speed}×", { speed: "↓1.2" })).toBe("Narrator · ↓1.2×");
    expect(fillPlaceholders("the {count} one", { count: 2 })).toBe("the second one");
  });

  it("splits actions from spoken text", () => {
    expect(splitActions("*waves* Hello there *nods*")).toEqual([
      { text: "waves", action: true },
      { text: " Hello there ", action: false },
      { text: "nods", action: true },
    ]);
    expect(splitActions("Plain line.")).toEqual([{ text: "Plain line.", action: false }]);
    expect(splitActions("a * b")).toEqual([{ text: "a * b", action: false }]);
  });
});
