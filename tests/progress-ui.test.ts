import { afterEach, describe, expect, it, vi } from "vitest";
import { mountProgressUi } from "../src/content/gallery/progressUi";
import { ProgressTracker, type ProgressApi } from "../src/content/progressTracker";
import { renderThumbs } from "../src/content/gallery/render";
import { parseGallery } from "../src/site/gallery";
import { emptyProgress, type ProgressRecord } from "../src/shared/progress";
import { fixture } from "./fixtures";

const BASE = "https://e-hentai.org/g/1234567/0123456789/";
const gallery = { gid: 1234567, token: "0123456789", host: "e-hentai.org", title: "Sample Gallery Title", pageCount: 172 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(stored: Partial<ProgressRecord> | null) {
  document.body.innerHTML = fixture("eh-gallery-p0.html").body.innerHTML;
  const api: ProgressApi = { get: async () => (stored ? { ...emptyProgress(gallery), ...stored } : null), put: async () => {} };
  const tracker = new ProgressTracker(api, gallery);
  const onContinue = vi.fn();
  const onShow = vi.fn();
  const ui = mountProgressUi(document, tracker, onContinue, onShow);
  return { tracker, ui, onContinue, onShow };
}

const banner = () => document.querySelector(".eroreader-banner");
const marked = () => [...document.querySelectorAll("#gdt .eroreader-last-read")].map((a) => a.getAttribute("href")!.split("-").pop());

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mountProgressUi", () => {
  it("shows nothing for a gallery without progress", async () => {
    setup(null);
    await settle();
    expect(banner()).toBeNull();
  });

  it("shows the banner above the thumbnails and marks the last-read thumbnail", async () => {
    const { onContinue } = setup({ page: 12 });
    await settle();
    expect(banner()!.nextElementSibling).toBe(document.querySelector(".gtb"));
    expect(banner()!.textContent).toContain("Page 12 of 172");
    expect(marked()).toEqual(["12"]);
    banner()!.querySelector<HTMLButtonElement>(".erb-primary")!.click();
    expect(onContinue).toHaveBeenCalledWith(12);
  });

  it("follows progress changes", async () => {
    const { tracker } = setup(null);
    await settle();
    tracker.pageShown(5);
    await tracker.flush();
    expect(banner()!.textContent).toContain("Page 5 of 172");
    await tracker.markFinished();
    expect(banner()!.querySelector(".erb-headline")!.textContent).toBe("Finished");
    expect(document.querySelectorAll(".eroreader-banner")).toHaveLength(1);
    await tracker.reset();
    expect(banner()).toBeNull();
    expect(marked()).toEqual([]);
  });

  it("wires Mark as finished, and Reset progress after asking, to the tracker", async () => {
    const { tracker } = setup({ page: 12 });
    await settle();
    const item = (label: string) => [...banner()!.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((b) => b.textContent === label)!;
    item("Mark as finished").click();
    await settle();
    expect(tracker.record.finished).toBe(true);
    // happy-dom has no confirm(): the browser's own dialog, stood in for.
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    window.confirm = confirm;
    item("Reset progress…").click();
    await settle();
    expect(tracker.record.page).toBe(12); // not confirmed
    item("Reset progress…").click();
    await settle();
    expect(tracker.record).toMatchObject({ page: 0, finished: false });
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("marks the thumbnail again after the grid is redrawn", async () => {
    const { ui } = setup({ page: 165 });
    await settle();
    expect(marked()).toEqual([]); // page 165 isn't on the first thumbnail page
    const last = parseGallery(fixture("eh-gallery-p8.html"), new URL(`${BASE}?p=8`))!;
    renderThumbs(document.querySelector("#gdt")!, last.thumbs);
    ui.refresh();
    expect(marked()).toEqual(["165"]);
  });
});
