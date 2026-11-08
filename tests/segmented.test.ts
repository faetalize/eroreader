import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "../src/shared/segmented";

function make(onChange = vi.fn()) {
  const control = new SegmentedControl({
    doc: document,
    label: "Reading mode",
    options: [
      { value: "page", label: "Page" },
      { value: "strip", label: "Strip" },
      { value: "scroll", label: "Scroll" },
    ],
    value: "page",
    onChange,
  });
  document.body.append(control.element);
  return { control, onChange, button: (value: string) => control.buttons.get(value as never)! };
}

// happy-dom has no layout: options 60 px wide, side by side from 2 px in.
function layout<T extends string>(control: SegmentedControl<T>) {
  [...control.buttons.values()].forEach((button, i) => {
    Object.defineProperty(button, "offsetLeft", { value: 2 + 60 * i, configurable: true });
    Object.defineProperty(button, "offsetWidth", { value: 60, configurable: true });
  });
  const thumb = control.element.querySelector<HTMLElement>(".seg-thumb")!;
  Object.defineProperty(thumb, "offsetWidth", { value: 60, configurable: true });
  Object.defineProperty(control.element, "clientWidth", { value: 184, configurable: true });
  control.value = control.value; // measured now
  return thumb;
}

const pointer = (target: Element, type: string, clientX: number) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX }));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SegmentedControl", () => {
  it("is a radio group with one tabbable option, the chosen one", () => {
    const { control, button } = make();
    expect(control.element.getAttribute("role")).toBe("radiogroup");
    expect([button("page").getAttribute("aria-checked"), button("strip").getAttribute("aria-checked")]).toEqual(["true", "false"]);
    expect([button("page").tabIndex, button("strip").tabIndex]).toEqual([0, -1]);
  });

  it("picks a clicked option and says so; setting the value doesn't", () => {
    const { control, onChange, button } = make();
    button("strip").click();
    expect(control.value).toBe("strip");
    expect(onChange).toHaveBeenCalledWith("strip");
    control.value = "page";
    expect(onChange).toHaveBeenCalledTimes(1);
    button("page").click(); // already chosen
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("moves the choice with the arrow keys, wrapping around", () => {
    const { control, onChange, button } = make();
    button("page").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(control.value).toBe("scroll");
    button("scroll").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(control.value).toBe("page");
    expect(onChange.mock.calls).toEqual([["scroll"], ["page"]]);
  });

  it("slides its thumb under the chosen option once it can be measured", () => {
    const { control, button } = make();
    expect(control.element.classList.contains("measured")).toBe(false);
    const thumb = layout(control);
    expect(control.element.classList.contains("measured")).toBe(true);
    button("scroll").click();
    expect([thumb.style.transform, thumb.style.width]).toEqual(["translateX(122px)", "60px"]);
  });

  it("drags the thumb along the track and picks where it's dropped", () => {
    const { control, onChange, button } = make();
    const thumb = layout(control);
    pointer(button("page"), "pointerdown", 30);
    pointer(control.element, "pointermove", 100); // 70 px along
    expect(thumb.style.transform).toBe("translateX(72px)");
    expect(control.element.classList.contains("dragging")).toBe(true);
    pointer(control.element, "pointerup", 100);
    button("page").click(); // the click the press ends with
    expect(control.value).toBe("strip");
    expect(onChange.mock.calls).toEqual([["strip"]]);
  });

  it("greys out and takes no picks while disabled, keeping its choice", () => {
    const { control, onChange, button } = make();
    control.disabled = true;
    expect([control.element.getAttribute("aria-disabled"), button("strip").disabled]).toEqual(["true", true]);
    button("strip").click();
    button("page").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect([control.value, onChange.mock.calls.length]).toEqual(["page", 0]);
    control.disabled = false;
    button("strip").click();
    expect(control.value).toBe("strip");
  });

  it("doesn't start a drag from an option that isn't chosen, nor for a tiny move", () => {
    const { control, onChange, button } = make();
    layout(control);
    pointer(button("strip"), "pointerdown", 90);
    pointer(control.element, "pointermove", 200);
    pointer(control.element, "pointerup", 200);
    expect(onChange).not.toHaveBeenCalled();
    pointer(button("page"), "pointerdown", 30);
    pointer(control.element, "pointermove", 32);
    pointer(control.element, "pointerup", 32);
    expect(control.value).toBe("page");
  });
});
