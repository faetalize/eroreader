import { describe, expect, it } from "vitest";
import { finishInSession, memoryArea, recentLines, saveRecentLines } from "../src/background/session";

describe("session memory", () => {
  it("counts each finished gallery once", async () => {
    const area = memoryArea();
    expect(await finishInSession(area, 1)).toBe(1);
    expect(await finishInSession(area, 1)).toBe(1);
    expect(await finishInSession(area, 2)).toBe(2);
  });

  it("keeps recent lines and ignores junk", async () => {
    const area = memoryArea();
    expect(await recentLines(area)).toEqual({});
    await saveRecentLines(area, { start: ["a", "b"], end: "x" });
    expect(await recentLines(area)).toEqual({ start: ["a", "b"] });
  });
});
