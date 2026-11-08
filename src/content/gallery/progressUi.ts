// Shows the gallery's progress on the gallery page: the banner above the thumbnails and the
// marker on the last-read thumbnail.
import { hasProgress, type ProgressRecord } from "../../shared/progress";
import type { ProgressTracker } from "../progressTracker";
import { createProgressBanner, markLastRead } from "./banner";

export interface ProgressUi {
  refresh(): void; // after the thumbnail grid is redrawn
  destroy(): void;
}

// The first background colour behind `el` that isn't transparent: the banner's primary button
// is drawn in the site's own colours, swapped.
function backgroundBehind(el: Element | null): string {
  for (let node = el; node; node = node.parentElement) {
    const color = node.ownerDocument.defaultView?.getComputedStyle(node).backgroundColor ?? "";
    if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return "Canvas";
}

export function mountProgressUi(doc: Document, tracker: ProgressTracker, onOpen: (page: number) => void, onShow: (page: number) => void): ProgressUi {
  let banner: HTMLElement | null = null;
  const confirmReset = () =>
    doc.defaultView?.confirm("Reset the reading progress for this gallery? The last page read and the furthest page are forgotten.") ?? false;

  const render = (record: ProgressRecord) => {
    const shown = hasProgress(record);
    const next = shown
      ? createProgressBanner(doc, { page: record.page, furthest: record.furthest, pageCount: record.pageCount, finished: record.finished }, {
          onOpen,
          onShow,
          onMarkFinished: () => void tracker.markFinished(),
          onReset: () => {
            if (confirmReset()) void tracker.reset();
          },
        })
      : null;
    if (banner && next) banner.replaceWith(next);
    else if (banner) banner.remove();
    else if (next) {
      const anchor = doc.querySelector(".gtb") ?? doc.querySelector("#gdt");
      anchor?.before(next);
    }
    banner = next;
    if (banner) {
      banner.style.setProperty("--erb-bg", backgroundBehind(banner.parentElement));
      const text = doc.defaultView?.getComputedStyle(banner).color;
      if (text) banner.style.setProperty("--erb-fg", text);
    }
    mark(record);
  };

  const mark = (record: ProgressRecord) => {
    const grid = doc.querySelector("#gdt");
    if (grid) markLastRead(grid, record.page > 0 ? record.page : null, record.page > 0 && !record.finished, record.furthest > record.page ? record.furthest : null);
  };

  const unsubscribe = tracker.subscribe(render);
  void tracker.ready().then(render);

  return {
    refresh: () => mark(tracker.record),
    destroy: () => {
      unsubscribe();
      banner?.remove();
    },
  };
}
