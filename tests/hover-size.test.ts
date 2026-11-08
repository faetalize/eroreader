import { afterEach, describe, expect, it, vi } from "vitest";
import { HoverSizeControl } from "../src/shared/hoverSizeControl";
import type { HoverSize } from "../src/shared/settings";

const SCALE: HoverSize = { by: "scale", scale: 2, offset: 100, width: 300 };

function make(value: HoverSize = SCALE, thumbWidth = 150) {
  const changes: HoverSize[] = [];
  const control = new HoverSizeControl({ doc: document, name: "testHover", label: "Test hover size", value, onChange: (size) => changes.push(size) });
  document.body.append(control.element);
  control.update(value, thumbWidth);
  const line = (by: "scale" | "offset" | "width") => control.element.querySelector<HTMLElement>(`.hs-line.${by}`)!;
  const radio = (by: "scale" | "offset" | "width") => line(by).querySelector<HTMLInputElement>("input[type=radio]")!;
  const offset = (label: string) => [...control.offsets.element.querySelectorAll("button")].find((b) => b.textContent === label)!;
  const slide = (value: number) => {
    control.scaleInput.value = String(value);
    control.scaleInput.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const type = (value: string) => {
    control.customInput.value = value;
    control.customInput.dispatchEvent(new Event("change", { bubbles: true }));
  };
  return { control, changes, line, radio, offset, slide, type };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("HoverSizeControl", () => {
  it("makes plain which of the two counts: its radio checked, the other line dimmed", () => {
    const { line, radio, control } = make();
    expect([radio("scale").checked, radio("offset").checked]).toEqual([true, false]);
    expect([line("scale").classList.contains("hs-off"), line("offset").classList.contains("hs-off")]).toEqual([false, true]);
    control.update({ ...SCALE, by: "offset" }, 150);
    expect([radio("scale").checked, line("scale").classList.contains("hs-off"), line("offset").classList.contains("hs-off")]).toEqual([false, true, false]);
  });

  it("has three lines, each led by a radio button and its short tag, one counting", () => {
    const { control, line, radio } = make();
    expect([...control.element.querySelectorAll(".hs-line")].map((l) => [l.classList[1], l.querySelector(".hs-tag")!.textContent])).toEqual([
      ["scale", "multi"],
      ["offset", "+px"],
      ["width", "px"],
    ]);
    expect([radio("scale").checked, radio("offset").checked, radio("width").checked]).toEqual([true, false, false]);
    expect(["scale", "offset", "width"].map((by) => line(by as "scale").classList.contains("hs-off"))).toEqual([false, true, true]);
    // The tag picks its line, like the radio.
    radio("width").closest("label")!.click();
    expect([radio("width").checked, line("width").classList.contains("hs-off"), line("scale").classList.contains("hs-off")]).toEqual([true, false, true]);
  });

  it("sets a width of its own, from the thumbnails' width up, following them as they change", () => {
    const { control, changes, line } = make({ by: "scale", scale: 2, offset: 100, width: 300 }, 150);
    const width = control.widthInput;
    expect([width.min, width.value]).toEqual(["150", "300"]);
    width.value = "420";
    width.dispatchEvent(new Event("input", { bubbles: true }));
    expect(changes.at(-1)).toEqual({ by: "width", scale: 2, offset: 100, width: 420 });
    expect(line("width").classList.contains("hs-off")).toBe(false);
    // Larger thumbnails: the range starts at them, and a smaller width shows as theirs,
    // silently, without anything saved.
    control.update({ by: "width", scale: 2, offset: 100, width: 200 }, 260);
    expect([width.min, width.value]).toEqual(["260", "260"]);
    expect(changes).toHaveLength(1);
    expect(control.element.textContent).not.toMatch(/raised|at least|minimum/i);
  });

  it("switches to the multiplier by dragging it, and to an added width by picking one", () => {
    const { slide, offset, changes } = make();
    offset("+200").click();
    expect(changes.at(-1)).toEqual({ by: "offset", scale: 2, offset: 200, width: 300 });
    slide(3.1);
    expect(changes.at(-1)).toEqual({ by: "scale", scale: 3.1, offset: 200, width: 300 });
  });

  it("makes a dimmed line count as soon as one of its controls is touched", () => {
    const { offset, line, changes } = make(); // +100 remembered, the multiplier counting
    offset("+100").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(changes.at(-1)).toEqual({ by: "offset", scale: 2, offset: 100, width: 300 });
    expect(line("offset").classList.contains("hs-off")).toBe(false);
  });

  it("switches with the radio buttons, keeping each line's value", () => {
    const { radio, changes } = make({ by: "offset", scale: 3.5, offset: 30, width: 300 });
    radio("scale").checked = true;
    radio("scale").dispatchEvent(new Event("change", { bubbles: true }));
    expect(changes.at(-1)).toEqual({ by: "scale", scale: 3.5, offset: 30, width: 300 });
  });

  it("takes a typed amount within its range, staying on Custom even when it matches an offered one", () => {
    const { control, offset, type, changes } = make();
    const box = control.customInput.parentElement!;
    expect(box.hidden).toBe(true);
    offset("Custom").click();
    expect([box.hidden, control.offsets.value]).toEqual([false, "custom"]);
    type("2000");
    expect([changes.at(-1)!.offset, control.customInput.value]).toEqual([1000, "1000"]);
    type("5");
    expect(changes.at(-1)).toEqual({ by: "offset", scale: 2, offset: 30, width: 300 });
    type("100");
    expect([control.offsets.value, box.hidden]).toEqual(["custom", false]);
    offset("+200").click();
    expect([control.offsets.value, box.hidden]).toEqual(["200", true]);
  });

  it("shows an editable field with the amount, in the offset line, once Custom is picked", () => {
    const { control, offset, line } = make({ by: "offset", scale: 2, offset: 100, width: 300 }); // +100 counting
    offset("Custom").click();
    const field = control.customInput;
    const shown = (el: HTMLElement | null): boolean => !el || (!el.hidden && shown(el.parentElement));
    expect([shown(field), field.disabled, field.readOnly, field.value]).toEqual([true, false, false, "100"]);
    expect(line("offset").contains(field)).toBe(true); // on the same line, not below it
    expect(document.activeElement).toBe(field);
  });

  it("leaves the arrow keys in the custom field to the field", () => {
    const { control, changes } = make({ by: "offset", scale: 2, offset: 450, width: 300 });
    const event = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
    control.customInput.dispatchEvent(event);
    expect([control.offsets.value, event.defaultPrevented, changes]).toEqual(["custom", false, []]);
  });

  it("shows an amount not offered as Custom", () => {
    const { control } = make({ by: "offset", scale: 2, offset: 450, width: 300 });
    expect([control.offsets.value, control.customInput.value]).toEqual(["custom", "450"]);
  });

  it("raises a small multiplier to its floor silently, explaining nothing", () => {
    const { control } = make({ by: "scale", scale: 1.2, offset: 100, width: 300 }, 80);
    expect(control.element.textContent).not.toMatch(/raised|at least|wider than/i);
    expect(control.element.querySelector(".hs-note")).toBeNull();
  });
});

// Sliders that fought while one was dragged: settings arriving during the drag are older than
// the slider, and must not move it; and nothing it saves may depend on anything else it shows.
describe("HoverSizeControl while in use", () => {
  it("leaves the width alone while it's dragged, however the thumbnails change meanwhile", () => {
    const { control, changes } = make({ by: "width", scale: 2, offset: 100, width: 300 }, 150);
    const width = control.widthInput;
    width.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    width.value = "500";
    width.dispatchEvent(new Event("input", { bubbles: true }));
    control.update({ by: "width", scale: 2, offset: 100, width: 300 }, 200); // older, and resized
    expect([width.value, changes.map((c) => c.width)]).toEqual(["500", [500]]);
  });

  it("leaves the multiplier alone while it's dragged, whatever arrives meanwhile", () => {
    const { control, slide, changes } = make();
    control.scaleInput.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    for (const [i, scale] of [2.2, 2.4, 2.6, 2.8].entries()) {
      slide(scale);
      control.update(changes[Math.max(0, i - 2)]!, 150); // echoes, two moves behind
      expect(control.scaleInput.value).toBe(String(scale));
    }
    expect(changes.map((c) => c.scale)).toEqual([2.2, 2.4, 2.6, 2.8]);
    control.scaleInput.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    control.update({ ...SCALE, scale: 2.8 }, 150);
    expect(control.scaleInput.value).toBe("2.8");
  });

  it("leaves the typed amount alone while it's being typed", () => {
    const { control, offset } = make({ by: "offset", scale: 2, offset: 450, width: 300 });
    offset("Custom").click(); // focuses the field
    control.customInput.focus();
    control.customInput.value = "62";
    control.update({ by: "offset", scale: 2, offset: 450, width: 300 }, 150);
    expect(control.customInput.value).toBe("62");
  });

  it("saves exactly what's set, never the floor, so nothing it shows feeds back into it", () => {
    const { slide, changes, control } = make({ by: "scale", scale: 1.2, offset: 100, width: 300 }, 80); // raised to the floor
    control.scaleInput.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    slide(1.3);
    slide(1.4);
    expect(changes.map((c) => c.scale)).toEqual([1.3, 1.4]);
    control.update({ by: "scale", scale: 1.4, offset: 100, width: 300 }, 64); // the thumbnails shrank meanwhile
    expect(changes).toHaveLength(2); // showing something new saves nothing
  });
});

describe("HoverSizeControl in a page", () => {
  it("doesn't save when only shown new values", () => {
    const onChange = vi.fn();
    const control = new HoverSizeControl({ doc: document, name: "x", label: "x", value: SCALE, onChange });
    control.update({ by: "offset", scale: 4, offset: 30, width: 300 }, 100);
    expect(onChange).not.toHaveBeenCalled();
  });
});
