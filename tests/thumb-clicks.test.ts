import { describe, expect, it, vi } from "vitest";
import { interceptThumbClicks } from "../src/content/gallery/thumbClicks";
import { fixture } from "./fixtures";

describe("interceptThumbClicks", () => {
  it("opens the reader at the clicked page, and leaves modified clicks alone", () => {
    document.body.innerHTML = fixture("eh-gallery-p8.html").body.innerHTML;
    const open = vi.fn();
    const stop = interceptThumbClicks(document, open);
    const thumb = document.querySelectorAll("#gdt a")[2]!.querySelector("div")!;
    const plain = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    thumb.dispatchEvent(plain);
    expect(open).toHaveBeenCalledWith(163);
    expect(plain.defaultPrevented).toBe(true);
    const newTab = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    thumb.dispatchEvent(newTab);
    expect(open).toHaveBeenCalledTimes(1);
    stop();
    document.body.innerHTML = "";
  });
});
