import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessagePicker, type MessagesFile, type RecentLines } from "../src/content/reader/auto/messages";
import { MIN_GAP_MS, toastDuration, Voice } from "../src/content/reader/auto/voice";

const file: MessagesFile = {
  pill: "Narrator · {speed}×",
  events: {
    start: ["*waves* Ready when you are", "Second start line"],
    locked: ["Locked line"],
    stopped: ["Stopped line"],
    end: ["End line"],
    finished_count: ["Finished the {count} gallery"],
  },
  rare: {},
};

function setup({ recent = {} as RecentLines, finished = 1 } = {}) {
  let clock = 0;
  const saved: RecentLines[] = [];
  const finishes: number[] = [];
  const voice = new Voice({
    doc: document,
    picker: new MessagePicker(file, {}, () => 0), // first line of each pool; no rare pools here
    session: {
      recent: async () => recent,
      saveRecent: (r) => saved.push(r),
      finish: async (gid) => {
        finishes.push(gid);
        return finished;
      },
    },
    gid: 7654321,
    now: () => new Date(2026, 10, 7, 15, 0),
    clock: () => clock,
  });
  document.body.append(voice.element);
  return { voice, saved, finishes, tick: (ms: number) => (clock += ms) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("Voice", () => {
  it("shows a line as a toast, with actions apart from spoken text", () => {
    const { voice } = setup();
    voice.event("start");
    expect(voice.showingToast).toBe(true);
    expect([...voice.element.querySelectorAll("span")].map((s) => [s.className, s.textContent])).toEqual([
      ["voice-action", "waves"],
      ["voice-spoken", " Ready when you are"],
    ]);
  });

  it("shrinks to the pill with the speed while hands-free runs", () => {
    const { voice } = setup();
    voice.speed({ multiplier: 1.24, direction: 1, locked: false });
    expect(voice.text).toBe("Narrator · ↓1.2×");
    voice.event("locked");
    expect(voice.text).toBe("Locked line");
    voice.speed({ multiplier: 2, direction: -1, locked: true });
    expect(voice.text).toBe("Locked line"); // the toast stays while it's read
    vi.advanceTimersByTime(toastDuration("Locked line"));
    expect(voice.element.classList.contains("pill")).toBe(true);
    expect(voice.text).toBe("Narrator · ↑2.0×");
    expect(voice.locked).toBe(true);
    voice.speed({ multiplier: 2, direction: -1, locked: false });
    expect(voice.locked).toBe(false);
  });

  it("shows no pill for a character without a pill template", () => {
    const voice = new Voice({
      doc: document,
      picker: new MessagePicker({ ...file, pill: "" }, {}, () => 0),
      session: { recent: async () => ({}), saveRecent: () => {}, finish: async () => 1 },
      gid: 1,
      clock: () => 0,
    });
    voice.speed({ multiplier: 1, direction: 1, locked: false });
    expect(voice.element.hidden).toBe(true);
  });

  it("fades out after the toast once hands-free has stopped", () => {
    const { voice } = setup();
    voice.speed({ multiplier: 1, direction: 1, locked: false });
    voice.speed(null);
    expect(voice.element.hidden).toBe(true);
    voice.event("stopped");
    vi.advanceTimersByTime(toastDuration("Stopped line"));
    expect(voice.element.hidden).toBe(true);
  });

  it("never shows toasts closer together than the minimum gap", () => {
    const { voice, tick } = setup();
    voice.event("start");
    tick(MIN_GAP_MS - 1);
    voice.event("locked");
    expect(voice.text).not.toBe("Locked line");
    tick(1);
    voice.event("locked");
    expect(voice.text).toBe("Locked line");
  });

  it("always shows the end, with the session's finished count", async () => {
    const { voice, finishes } = setup({ finished: 3 });
    voice.event("start");
    voice.event("end");
    await vi.advanceTimersByTimeAsync(0);
    expect(finishes).toEqual([7654321]);
    expect(voice.text).toBe("Finished the third gallery");
  });

  it("uses the regular end for the first gallery of the session", async () => {
    const { voice } = setup({ finished: 1 });
    voice.event("end");
    await vi.advanceTimersByTimeAsync(0);
    expect(voice.text).toBe("End line");
  });

  it("carries recent lines through the session", async () => {
    const { voice, saved } = setup({ recent: { start: ["*waves* Ready when you are"] } });
    await vi.advanceTimersByTimeAsync(0);
    voice.event("start");
    expect(voice.text).toBe("Second start line");
    expect(saved.at(-1)!.start).toEqual(["*waves* Ready when you are", "Second start line"]);
  });
});
