import { describe, expect, it } from "vitest";
import { ACTIONS, badgeOf, buildKeymap, keyName, normalizeKey } from "../src/content/reader/shortcuts";

describe("shortcuts", () => {
  it("gives every key one action", () => {
    const keys = ACTIONS.flatMap((action) => action.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(buildKeymap().get("o")).toBe("offset");
    expect(buildKeymap().get(normalizeKey("O"))).toBe("offset");
  });

  it("names keys the way buttons show them", () => {
    expect([" ", "Escape", "ArrowRight", "-", "t", "["].map(keyName)).toEqual(["Space", "Esc", "→", "−", "T", "["]);
    expect(badgeOf("zoomOut")).toBe("−");
    expect(badgeOf("close")).toBe("Esc");
  });
});
