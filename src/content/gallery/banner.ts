// The progress banner on the gallery page and the last-read thumbnail marker.
import { isRereading } from "../../shared/progress";

export interface BannerProgress {
  page: number; // last page read
  furthest: number;
  pageCount: number;
  finished: boolean;
}

export interface BannerActions {
  onOpen: (page: number) => void; // the reader, at `page`
  onShow: (page: number) => void; // brings the thumbnail of `page` into view on the gallery page
  onMarkFinished: () => void;
  onReset: () => void; // asks first
}

const LAST_READ = "eroreader-last-read";
const FURTHEST = "eroreader-furthest";

// The status line: the headline, and quieter detail beside it.
export function bannerStatus(progress: BannerProgress): { headline: string; detail: string | null } {
  const { page, furthest, pageCount, finished } = progress;
  if (finished && !isRereading(progress)) return { headline: "Finished", detail: `${pageCount} pages` };
  const headline = `Page ${page} of ${pageCount}`;
  if (finished) return { headline, detail: "finished before" };
  return { headline, detail: furthest > page ? `furthest page ${furthest}` : null };
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(doc: Document, className: string, label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const node = el(doc, "button", className, label);
  node.type = "button";
  if (title) node.title = title;
  node.addEventListener("click", onClick);
  return node;
}

// The gallery page's progress banner. One line says where reading stands, one bar shows it, one
// primary action resumes, secondary actions sit beside it, and the rare or destructive ones are
// in a small menu. A container query rearranges it for narrow spaces, so it never wraps by
// accident (see styles.ts).
export function createProgressBanner(doc: Document, progress: BannerProgress, actions: BannerActions): HTMLElement {
  const { page, furthest, pageCount, finished } = progress;
  const banner = el(doc, "section", "eroreader-banner");
  banner.setAttribute("aria-label", "Reading progress");
  const inner = el(doc, "div", "erb-inner");

  const { headline, detail } = bannerStatus(progress);
  const status = el(doc, "p", "erb-status");
  status.append(el(doc, "strong", "erb-headline", headline));
  if (detail) {
    const extra = el(doc, "span", "erb-detail");
    // The furthest page is the bar's lighter part: a swatch says so.
    if (!finished && furthest > page) extra.append(el(doc, "span", "erb-swatch"));
    extra.append(detail);
    status.append(extra);
  }

  const bar = el(doc, "div", "erb-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(pageCount));
  bar.setAttribute("aria-valuenow", String(page));
  bar.setAttribute("aria-valuetext", detail ? `${headline}, ${detail}` : headline);
  const share = (n: number) => `${Math.min(100, (100 * n) / Math.max(1, pageCount))}%`;
  const furthestFill = el(doc, "div", "erb-fill-furthest");
  furthestFill.style.width = share(furthest);
  const fill = el(doc, "div", "erb-fill");
  fill.style.width = share(finished && !isRereading(progress) ? pageCount : page);
  bar.append(furthestFill, fill);

  const done = finished && !isRereading(progress);
  const actionsBox = el(doc, "div", "erb-actions");
  actionsBox.append(
    done
      ? button(doc, "erb-primary", "Read again", () => actions.onOpen(1), "Open the reader at the first page")
      : button(doc, "erb-primary", "Resume", () => actions.onOpen(page), `Open the reader at page ${page}, where you left off`),
  );
  if (!finished && furthest > page) {
    actionsBox.append(button(doc, "erb-secondary", "Jump to furthest", () => actions.onOpen(furthest), `Open the reader at page ${furthest}, the furthest you've read`));
  }
  const show = () => actions.onShow(Math.max(1, page));
  actionsBox.append(button(doc, "erb-quiet erb-show", "Show on page", show, "Show the last-read thumbnail on this page"));

  // Rare and destructive actions: a small menu.
  const items: [string, string, () => void][] = [["erb-menu-show", "Show on page", show]];
  if (!finished) items.push(["", "Mark as finished", actions.onMarkFinished]);
  items.push(["erb-danger", "Reset progress…", actions.onReset]);
  actionsBox.append(moreMenu(doc, items));

  inner.append(status, actionsBox, bar);
  banner.append(inner);
  return banner;
}

// A "more actions" button with a menu: Esc, a click elsewhere or picking an item closes it, and
// the arrow keys move between items.
function moreMenu(doc: Document, items: [string, string, () => void][]): HTMLElement {
  const box = el(doc, "div", "erb-more");
  const menu = el(doc, "div", "erb-menu");
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const toggle = button(doc, "erb-quiet erb-more-button", "⋯", () => (menu.hidden ? open() : close()), "More actions");
  toggle.setAttribute("aria-label", "More actions");
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");
  const entries = items.map(([className, label, run]) => {
    const item = button(doc, `erb-item ${className}`.trim(), label, () => {
      close();
      run();
    });
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    return item;
  });
  menu.append(...entries);
  const onOutside = (event: Event) => {
    if (!box.contains(event.target as Node)) close();
  };
  const open = () => {
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    doc.addEventListener("pointerdown", onOutside, true);
  };
  const close = () => {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", onOutside, true);
  };
  box.addEventListener("keydown", (event) => {
    // Items the layout hides (Show on page, outside narrow banners) are skipped.
    const shown = entries.filter((item) => doc.defaultView?.getComputedStyle(item).display !== "none");
    const at = shown.indexOf(doc.activeElement as HTMLButtonElement);
    if (event.key === "Escape" && !menu.hidden) {
      close();
      toggle.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (menu.hidden) open();
      const step = event.key === "ArrowDown" ? 1 : -1;
      shown[(at + step + shown.length) % shown.length]?.focus();
    } else {
      return;
    }
    event.preventDefault();
  });
  box.append(toggle, menu);
  return box;
}

const READING = "eroreader-reading";

// Marks the thumbnail of `page` in the grid, if it's on the thumbnail page shown. While the
// gallery is still being read, the mark pulses so it's found at a glance. The furthest page
// read, when it's further, gets a quieter mark of its own.
export function markLastRead(grid: Element, page: number | null, reading = false, furthest: number | null = null): void {
  for (const link of grid.querySelectorAll(`.${LAST_READ}, .${FURTHEST}`)) link.classList.remove(LAST_READ, READING, FURTHEST);
  for (const link of grid.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href")!;
    if (page !== null && href.endsWith(`-${page}`)) link.classList.add(LAST_READ, ...(reading ? [READING] : []));
    if (furthest !== null && furthest !== page && href.endsWith(`-${furthest}`)) {
      link.classList.add(FURTHEST);
      link.setAttribute("title", "The furthest page read");
    }
  }
}
