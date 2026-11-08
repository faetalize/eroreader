// The reader: a fullscreen overlay on the gallery page. It never navigates away, so the
// gallery underneath stays exactly as it was.
import { icon } from "../../shared/icons";
import { hoverWidth, THUMB_WIDTH_RANGE, type Settings, type ThumbView } from "../../shared/settings";
import type { ThumbStore } from "../gallery/thumbStore";
import { parsePageHash, type ReaderHistory } from "./history";
import { ImageBuffer, type PageState } from "./imageBuffer";
import type { PageSource } from "./pageSource";
import { preloadOrder } from "./preloadWindow";
import { QuickSettings } from "./quickSettings";
import { READER_CSS } from "./readerStyles";
import { AutoMode, type SpeedReport } from "./auto/autoMode";
import type { AutoEvent } from "./auto/messages";
import { speedFor, type Direction } from "./auto/speed";
import { actionOf, badgeOf, buildKeymap, keyName, normalizeKey, resolveActions, resolveAutoActions, type Action, type ActionId } from "./shortcuts";
import { computeSpreads, SpreadIndex } from "./spreads";
import { keyBadge, ThumbGallery, type ReadingMarks } from "./thumbGallery";
import { NO_INSETS, PageView, StripView, type Insets, type ViewDeps } from "./views";
import { clampScale, FIT, scaleOf, spreadNatural, zoomStep, type Size, type Zoom } from "./zoom";
import { SegmentedControl } from "../../shared/segmented";

// Zoom scrubbing: the scale is multiplied by this per pixel dragged.
const SCRUB_PER_PX = 1.004;

export type ReaderMode = "page" | "strip";

// What hands-free mode talks through: a character's messages, when a character is loaded.
export interface AutoVoice {
  readonly element: HTMLElement;
  event(event: AutoEvent): void;
  speed(speed: SpeedReport | null): void;
  destroy(): void;
}

export interface ReaderOptions {
  doc: Document;
  source: PageSource;
  store: ThumbStore;
  history: ReaderHistory;
  settings: () => Settings;
  saveSettings?: (patch: Partial<Settings>) => void; // remembers view choices such as thumbnail sizes
  title: string;
  createImage?: () => HTMLImageElement;
  // `page` is the first page on screen, `visible` all of them (two in a spread).
  onPageChange?: (page: number, visible: number[]) => void;
  onDirectionChange?: (rtl: boolean) => void; // the user switched it, not setRtl()
  onSpreadSettingsChange?: (offset: boolean, repairPoints: number[]) => void; // likewise
  onClose?: () => void; // the gallery is back where it was
  createVoice?: () => AutoVoice | null; // null without a character
  openSettings?: () => void; // the extension's Settings page, from the quick settings
}

// Unless pinned, the toolbar shows for a moment when the reader opens, then only when the
// pointer comes within the upper half of where it sits, staying while it's on the toolbar and
// going a moment after it leaves. Lower down doesn't bring it back, so the grid's top edge,
// which starts below the toolbar, stays within reach.
const BAR_GLIMPSE_MS = 2500;
const BAR_EDGE = 4; // px from the screen's top, at least, whatever the toolbar's height
const BAR_LEAVE_MS = 400;
const PAN_THRESHOLD = 5;
const NOTICE_MS = 3000;
const THUMB_STEP = 1.2; // thumbnail size change per [ or ]

interface Ui {
  host: HTMLElement;
  root: HTMLDivElement;
  toolbar: HTMLElement;
  indicator: HTMLElement;
  progress: HTMLElement; // under the indicator: how far into the gallery
  mode: SegmentedControl<ReaderMode>;
  direction: SegmentedControl<"ltr" | "rtl">;
  zoom: { element: HTMLElement; input: HTMLInputElement; fitTag: HTMLElement };
  spreadButton: HTMLButtonElement;
  offsetButton: HTMLButtonElement;
  repairButton: HTMLButtonElement;
  filmstripButton: HTMLButtonElement;
  gridButton: HTMLButtonElement;
  hoverButton: HTMLButtonElement;
  position: SegmentedControl<"bottom" | "left">; // greyed out while the filmstrip is closed
  settingsButton: HTMLButtonElement;
  quickSettings: QuickSettings;
  filmstrip: ThumbGallery | null; // built the first time each is opened
  grid: ThumbGallery | null;
  help: HTMLElement;
  blank: HTMLElement;
  notice: HTMLElement;
  auto: AutoMode;
  voice: AutoVoice | null;
  pageView: PageView;
  stripView: StripView | null; // built the first time strip mode is used
  buffer: ImageBuffer;
  unsubscribe: () => void;
  saved: { scrollX: number; scrollY: number; overflow: string };
}

export class Reader {
  readonly #options: ReaderOptions;
  #ui: Ui | null = null;
  #page = 1;
  #mode: ReaderMode = "page";
  #rtl = false;
  #zoom: Zoom = FIT;
  #hidden = false;
  #spreads = false;
  #spreadOffset = false;
  #repairPoints: number[] = [];
  #spreadIndex: SpreadIndex | null = null; // rebuilt when page shapes or settings change
  #barTimer: ReturnType<typeof setTimeout> | null = null; // hides the toolbar
  #toolbarHeight = 0; // as last measured
  #noticeTimer: ReturnType<typeof setTimeout> | null = null;
  #scrollRemainder = 0; // strip mode auto-scroll below a whole pixel, carried to the next frame
  #insets: Insets = NO_INSETS; // measured in #updateInsets()
  #marks: ReadingMarks = { furthest: null };
  // The keys in use: the defaults with the user's rebindings, rebuilt when settings change.
  #actions: Action[] = resolveActions();
  #autoActions = resolveAutoActions();
  #keymap = buildKeymap(this.#actions);
  readonly #badges = new Map<ActionId, { button: HTMLElement; badge: HTMLElement }[]>();

  constructor(options: ReaderOptions) {
    this.#options = options;
  }

  get isOpen(): boolean {
    return this.#ui !== null;
  }
  get page(): number {
    return this.#page;
  }
  get mode(): ReaderMode {
    return this.#mode;
  }
  get rtl(): boolean {
    return this.#rtl;
  }
  get zoom(): Zoom {
    return this.#zoom;
  }
  get hidden(): boolean {
    return this.#hidden;
  }
  get helpOpen(): boolean {
    return this.#ui ? !this.#ui.help.hidden : false;
  }
  get quickSettingsOpen(): boolean {
    return this.#ui?.quickSettings.isOpen ?? false;
  }
  // The shadow root, for tests and for later milestones' overlays.
  get shadowRoot(): ShadowRoot | null {
    return this.#ui?.host.shadowRoot ?? null;
  }
  get bufferedPages(): number[] {
    return this.#ui?.buffer.pages() ?? [];
  }
  get spreads(): boolean {
    return this.#spreads;
  }
  get spreadSettings(): { offset: boolean; repairPoints: number[] } {
    return { offset: this.#spreadOffset, repairPoints: [...this.#repairPoints] };
  }
  // Pages on screen: two in a spread, else one.
  get visiblePages(): number[] {
    return this.#visible(this.#page);
  }
  get filmstripOpen(): boolean {
    return this.#ui?.filmstrip?.isOpen ?? false;
  }
  get gridOpen(): boolean {
    return this.#ui?.grid?.isOpen ?? false;
  }
  get autoState(): string {
    return this.#ui?.auto.state ?? "idle";
  }
  get auto(): AutoMode | null {
    return this.#ui?.auto ?? null;
  }
  // The last short message shown over the reader, e.g. what O or P changed.
  get noticeText(): string {
    return this.#ui?.notice.hidden === false ? (this.#ui.notice.textContent ?? "") : "";
  }

  open(page: number, { push = true }: { push?: boolean } = {}): void {
    if (this.#ui) {
      this.goTo(page);
      return;
    }
    this.#ui = this.#build();
    this.#renderZoom();
    this.#page = this.#anchor(this.#clamp(page));
    this.#options.history.opened(this.#page, push);
    this.#listen(true);
    this.#updateInsets(false);
    this.#showMode();
    this.#setCurrent(this.#page, false);
    this.#showBar(BAR_GLIMPSE_MS);
  }

  // Closes without touching history: Back already left the reader's entry.
  close(): void {
    const ui = this.#ui;
    if (!ui) return;
    this.#options.history.cancel();
    this.#listen(false);
    if (this.#barTimer !== null) clearTimeout(this.#barTimer);
    if (this.#noticeTimer !== null) clearTimeout(this.#noticeTimer);
    ui.auto.destroy();
    ui.voice?.destroy();
    ui.unsubscribe();
    ui.stripView?.destroy();
    ui.filmstrip?.destroy();
    ui.grid?.destroy();
    ui.buffer.clear();
    ui.host.remove();
    const html = this.#options.doc.documentElement;
    html.style.overflow = ui.saved.overflow;
    this.#options.doc.defaultView?.scrollTo(ui.saved.scrollX, ui.saved.scrollY);
    this.#options.onClose?.(); // after the gallery is back as it was, so it can move on from there
    this.#ui = null;
    this.#hidden = false;
  }

  // Esc and the toolbar button: leave the reader's history entry, which closes the reader.
  requestClose(): void {
    if (!this.#ui) return;
    if (this.#options.history.leave() === "replaced") this.close();
  }

  handlePopState(url: URL): void {
    const page = parsePageHash(url.hash);
    if (this.#ui && page === null) this.close();
    else if (!this.#ui && page !== null) this.open(page, { push: false });
    else if (this.#ui && page !== null && page !== this.#page) this.goTo(page);
  }

  goTo(page: number): void {
    if (!this.#ui) return;
    this.#setCurrent(this.#anchor(this.#clamp(page)), false);
  }

  next(): void {
    if (this.#spreadsShown()) {
      const next = this.#index().next(this.#page);
      if (next) this.goTo(next[0]!);
    } else if (this.#page < this.#options.source.pageCount) this.goTo(this.#page + 1);
  }

  prev(): void {
    if (this.#spreadsShown()) {
      const prev = this.#index().prev(this.#page);
      if (prev) this.goTo(prev[0]!);
    } else if (this.#page > 1) this.goTo(this.#page - 1);
  }

  toggleSpreads(): void {
    this.#spreads = !this.#spreads;
    if (!this.#ui) return;
    this.#ui.spreadButton.setAttribute("aria-pressed", String(this.#spreads));
    if (this.#mode === "page") this.#setCurrent(this.#anchor(this.#page), false);
    else this.#updateSpreadButtons();
  }

  setSpreadSettings(offset: boolean, repairPoints: number[]): void {
    this.#spreadOffset = offset;
    this.#repairPoints = [...repairPoints];
    this.#spreadsChanged();
    this.#updateSpreadButtons();
  }

  // O: whether the cover pairs with page 2. Says what changed, or why nothing did.
  toggleSpreadOffset(): void {
    if (!this.#ui) return;
    if (!this.#spreadsShown()) {
      this.#notice(this.#spreadsOffMessage());
      return;
    }
    const { source } = this.#options;
    const before = this.#index().spreads;
    this.#spreadOffset = !this.#spreadOffset;
    const shownBefore = this.#visible(this.#page).join();
    this.#spreadsChanged();
    this.#updateSpreadButtons();
    this.#options.onSpreadSettingsChange?.(this.#spreadOffset, [...this.#repairPoints]);

    const state = this.#spreadOffset ? "Cover paired with page 2" : "Cover shown alone";
    if (sameSpreads(before, this.#index().spreads)) {
      const reason = source.pageCount < 2 ? "the gallery has one page" : source.isWide(1) ? "the cover is a wide page" : "page 2 is a wide page";
      this.#notice(`${state}. Nothing changes: ${reason}.`);
    } else if (this.#visible(this.#page).join() === shownBefore) {
      const restart = this.#restartBefore(this.#page);
      this.#notice(restart === null ? `${state}.` : `${state}. The pages on screen stay as they are.`);
    } else {
      this.#notice(`${state}.`);
    }
  }

  // P: flips the pairing from the first page on screen, or undoes a flip made there.
  toggleRepairPoint(): void {
    if (!this.#ui) return;
    if (!this.#spreadsShown()) {
      this.#notice(this.#spreadsOffMessage());
      return;
    }
    const page = this.#page;
    const before = this.#index().spreads;
    const removing = this.#repairPoints.includes(page);
    this.#repairPoints = removing ? this.#repairPoints.filter((p) => p !== page) : [...this.#repairPoints, page].sort((a, b) => a - b);
    this.#spreadsChanged();
    this.#updateSpreadButtons();
    this.#options.onSpreadSettingsChange?.(this.#spreadOffset, [...this.#repairPoints]);

    const state = removing ? `Re-pair at page ${page} removed.` : `Pairing flipped from page ${page} on.`;
    this.#notice(sameSpreads(before, this.#index().spreads) ? `${state} Nothing changes: a wide page already starts a new pair here.` : state);
  }

  #spreadsOffMessage(): string {
    return this.#mode === "page"
      ? `Two-page spreads are off. Turn them on with ${this.#keyText("spreads", "the Spread button")} first.`
      : `Two-page spreads only show in page mode (${this.#keyText("mode", "the mode button")}).`;
  }

  // The latest page at or before `page`, after the cover, where pairing restarts no matter
  // what came before: a wide page, the page after one, or a re-pair point.
  #restartBefore(page: number): number | null {
    const { source } = this.#options;
    for (let p = page; p >= 2; p--) {
      if (this.#repairPoints.includes(p) || source.isWide(p) || source.isWide(p - 1)) return p;
    }
    return null;
  }

  #updateSpreadButtons(): void {
    const ui = this.#ui;
    if (!ui) return;
    const shown = this.#spreadsShown();
    ui.offsetButton.hidden = ui.repairButton.hidden = !shown;
    ui.offsetButton.setAttribute("aria-pressed", String(this.#spreadOffset));
    ui.repairButton.setAttribute("aria-pressed", String(this.#repairPoints.includes(this.#page)));
  }

  #notice(text: string): void {
    const ui = this.#ui;
    if (!ui) return;
    ui.notice.textContent = text;
    ui.notice.hidden = false;
    if (this.#noticeTimer !== null) clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => {
      if (this.#ui) this.#ui.notice.hidden = true;
    }, NOTICE_MS);
  }

  toggleFilmstrip(): void {
    const ui = this.#ui;
    if (!ui) return;
    ui.filmstrip ??= this.#thumbGallery("filmstrip");
    if (ui.filmstrip.isOpen) ui.filmstrip.close();
    else ui.filmstrip.open();
    ui.filmstripButton.setAttribute("aria-pressed", String(ui.filmstrip.isOpen));
    ui.position.disabled = !ui.filmstrip.isOpen;
    this.#panelsChanged();
    this.#updateInsets();
  }

  toggleGrid(): void {
    const ui = this.#ui;
    if (!ui) return;
    ui.grid ??= this.#thumbGallery("grid");
    if (ui.grid.isOpen) ui.grid.close();
    else {
      ui.auto.stopSilently(); // the grid covers the zone
      ui.grid.open();
    }
    ui.gridButton.setAttribute("aria-pressed", String(ui.grid.isOpen));
    ui.root.classList.toggle("grid-open", ui.grid.isOpen);
    this.#panelsChanged();
  }

  // Whether a panel is open, for its controls to stay in sight while the toolbar hides.
  #panelsChanged(): void {
    const ui = this.#ui;
    if (ui) ui.root.classList.toggle("panels-open", Boolean(ui.filmstrip?.isOpen || ui.grid?.isOpen));
  }

  // V: the filmstrip along the bottom or on the left edge, opening it if it's closed.
  toggleFilmstripVertical(): void {
    const ui = this.#ui;
    if (!ui) return;
    const vertical = !this.#options.settings().filmstripVertical;
    this.#options.saveSettings?.({ filmstripVertical: vertical });
    ui.position.value = vertical ? "left" : "bottom";
    ui.filmstrip?.setOptions({ vertical });
    if (!ui.filmstrip?.isOpen) this.toggleFilmstrip();
    else this.#updateInsets();
  }

  // The furthest page ever read, for the filmstrip and grid to mark.
  setMarks(marks: ReadingMarks): void {
    this.#marks = { ...marks };
    this.#ui?.filmstrip?.setMarks(this.#marks);
    this.#ui?.grid?.setMarks(this.#marks);
  }

  // Space, hands-free's one key: off, it starts locked at the pace last used in this reading
  // mode (or the default); steering on the pill, it locks the current speed; locked, it stops.
  // (Moving off the pill already ends an unlocked run.)
  toggleHandsFree(): void {
    const ui = this.#ui;
    if (!ui) return;
    if (ui.auto.toggleLock()) return;
    if (this.gridOpen) {
      this.#notice("Hands-free mode doesn't run while the grid is open.");
      return;
    }
    const settings = this.#options.settings();
    const pace = settings.autoPace[this.#mode] ?? settings.autoDefaultPace[this.#mode];
    ui.auto.startLocked(speedFor(this.#mode, pace));
  }

  // H: the filmstrip's and grid's hover preview on or off.
  toggleHoverZoom(): void {
    if (!this.#ui) return;
    const on = !this.#options.settings().hoverZoom;
    this.#options.saveSettings?.({ hoverZoom: on });
    this.applySettings(this.#options.settings());
    this.#notice(on ? "Hover zoom on." : "Hover zoom off.");
  }

  // [ and ]: thumbnail size in the grid if it's open, else in the filmstrip.
  resizeThumbs(direction: 1 | -1): void {
    const ui = this.#ui;
    if (!ui) return;
    const view: ThumbView | null = ui.grid?.isOpen ? "grid" : ui.filmstrip?.isOpen ? "filmstrip" : null;
    if (!view) return;
    const widths = this.#options.settings().thumbWidth;
    const range = THUMB_WIDTH_RANGE[view];
    const width = Math.round(Math.min(range.max, Math.max(range.min, widths[view] * THUMB_STEP ** direction)));
    this.#options.saveSettings?.({ thumbWidth: { ...widths, [view]: width } });
    ui[view]?.setOptions({ width, hover: hoverOf(this.#options.settings(), view) }); // which follows the thumbnails' width
    if (view === "filmstrip") this.#updateInsets();
  }

  // Settings changed in the quick settings, another tab or the options page.
  applySettings(settings: Settings): void {
    this.#setKeys(settings);
    const ui = this.#ui;
    if (!ui) return;
    if (!ui.auto.dragging) ui.auto.layout(); // the pill moved in another tab
    ui.hoverButton.setAttribute("aria-pressed", String(settings.hoverZoom));
    ui.position.value = settings.filmstripVertical ? "left" : "bottom";
    ui.filmstrip?.setOptions({ width: settings.thumbWidth.filmstrip, vertical: settings.filmstripVertical, hover: hoverOf(settings, "filmstrip") });
    ui.grid?.setOptions({ width: settings.thumbWidth.grid, hover: hoverOf(settings, "grid"), gridWidth: settings.gridWidth, gridHeight: settings.gridHeight });
    this.#retarget(this.#mode === "page" ? this.#visible(this.#page) : [this.#page]);
    ui.quickSettings.update(settings);
    this.#updateInsets();
  }

  // Measures what the toolbar (when pinned) and the open filmstrip cover, and lays the pages
  // out again if that changed.
  #updateInsets(relayout = true): void {
    const ui = this.#ui;
    if (!ui) return;
    const pinned = this.#options.settings().toolbarPinned;
    ui.root.classList.toggle("pinned", pinned);
    const toolbarHeight = Math.round(ui.toolbar.getBoundingClientRect().height);
    this.#toolbarHeight = toolbarHeight;
    ui.root.style.setProperty("--toolbar-height", `${toolbarHeight}px`);
    const strip = ui.filmstrip?.isOpen ? ui.filmstrip : null;
    const box = strip?.element.getBoundingClientRect();
    const vertical = strip?.options.vertical ?? false;
    const next: Insets = {
      top: pinned ? toolbarHeight : 0,
      bottom: strip && !vertical ? Math.round(box!.height) : 0,
      left: strip && vertical ? Math.round(box!.width) : 0,
    };
    const changed = next.top !== this.#insets.top || next.bottom !== this.#insets.bottom || next.left !== this.#insets.left;
    this.#insets = next;
    if (!changed || !relayout) return;
    if (this.#mode === "page") ui.pageView.reinset();
    else ui.stripView?.layout();
  }

  toggleQuickSettings(): void {
    const ui = this.#ui;
    if (!ui) return;
    if (ui.quickSettings.isOpen) ui.quickSettings.close();
    else ui.quickSettings.open();
    ui.settingsButton.setAttribute("aria-pressed", String(ui.quickSettings.isOpen));
  }

  #spreadsShown(): boolean {
    return this.#spreads && this.#mode === "page";
  }

  #index(): SpreadIndex {
    const { source } = this.#options;
    this.#spreadIndex ??= new SpreadIndex(
      computeSpreads(source.pageCount, (page) => source.isWide(page), this.#spreadOffset, this.#repairPoints),
      source.pageCount,
    );
    return this.#spreadIndex;
  }

  // The first page of the spread holding `page`, or `page` itself without spreads.
  #anchor(page: number): number {
    return this.#spreadsShown() ? this.#index().of(page)[0]! : page;
  }

  #visible(page: number): number[] {
    return this.#spreadsShown() ? this.#index().of(page) : [page];
  }

  // Pairing may change when settings change or page shapes become known: re-show the
  // current spread if it did.
  #spreadsChanged(): void {
    this.#spreadIndex = null;
    const ui = this.#ui;
    if (!ui || !this.#spreadsShown()) return;
    const visible = this.#visible(this.#page);
    const shown = ui.pageView.pages;
    if (visible.length !== shown.length || visible.some((page, i) => page !== shown[i])) {
      this.#setCurrent(visible[0]!, false);
    }
  }

  // Uses the keys in `settings`, and shows them everywhere a key is named.
  #setKeys(settings: Settings, render = true): void {
    this.#actions = resolveActions(settings.keys);
    this.#autoActions = resolveAutoActions(settings.keys);
    this.#keymap = buildKeymap(this.#actions);
    if (!render || !this.#ui) return;
    for (const id of this.#badges.keys()) this.#refreshBadge(id);
    const root = this.#ui.root;
    this.#renderHelp(root.querySelector("table.help-keys")!, root.querySelector("table.help-auto-keys")!);
    this.#ui.filmstrip?.refreshKeys();
    this.#ui.grid?.refreshKeys();
  }

  #trackBadge(id: ActionId, button: HTMLElement, badge: HTMLElement): void {
    const list = this.#badges.get(id) ?? [];
    list.push({ button, badge });
    this.#badges.set(id, list);
    this.#refreshBadge(id);
  }

  #refreshBadge(id: ActionId): void {
    const key = badgeOf(id, this.#actions);
    for (const { button, badge } of this.#badges.get(id) ?? []) {
      badge.textContent = key;
      // No badge when there's no key, or when the button's label already is the key (−, +, ?).
      badge.hidden = key === "" || button.firstChild?.textContent === key;
      button.title = this.#describe(id);
    }
  }

  // An action's description with its key, for tooltips.
  #describe(id: ActionId): string {
    const key = badgeOf(id, this.#actions);
    const description = actionOf(id, this.#actions).description;
    return key ? `${description} (${key})` : description;
  }

  // The key that runs an action, or a fallback when it has none.
  #keyText(id: ActionId, fallback: string): string {
    return badgeOf(id, this.#actions) || fallback;
  }

  #renderHelp(table: HTMLTableElement, autoTable: HTMLTableElement): void {
    const doc = this.#options.doc;
    const fill = (target: HTMLTableElement, actions: { keys: string[]; description: string }[]) => {
      target.replaceChildren();
      for (const action of actions) {
        const row = target.insertRow();
        const keys = row.insertCell();
        for (const key of action.keys) {
          const kbd = doc.createElement("kbd");
          kbd.textContent = keyName(key);
          keys.append(kbd);
        }
        if (action.keys.length === 0) keys.textContent = "—";
        row.insertCell().textContent = action.description;
      }
    };
    fill(table, this.#actions);
    fill(autoTable, this.#autoActions);
  }

  #thumbGallery(layout: ThumbView): ThumbGallery {
    const ui = this.#ui!;
    const { source } = this.#options;
    const settings = this.#options.settings();
    const gallery = new ThumbGallery(layout, {
      doc: this.#options.doc,
      pageCount: source.pageCount,
      thumb: (page) => source.thumb(page),
      thumbPageOf: (page) => source.thumbPageOf(page),
      wantThumbPages: (thumbPages) => source.wantThumbPages(layout, thumbPages),
      onSpriteError: (page) => source.spriteFailed(page),
      onGridSize: ({ width, height }) => this.#options.saveSettings?.({ gridWidth: width, gridHeight: height }),
      onPick: (page) => {
        if (layout === "grid") this.toggleGrid();
        this.goTo(page);
      },
      onAction: (id) => this.#perform(id, false),
      describe: (id) => this.#describe(id),
      badge: (id) => badgeOf(id, this.#actions),
    }, {
      width: settings.thumbWidth[layout],
      vertical: layout === "filmstrip" && settings.filmstripVertical,
      hover: hoverOf(settings, layout),
      gridWidth: settings.gridWidth,
      gridHeight: settings.gridHeight,
    });
    gallery.setCurrent(this.#page);
    gallery.setBuffered(ui.buffer.pages());
    gallery.setMarks(this.#marks);
    ui.root.append(gallery.element);
    return gallery;
  }

  setMode(mode: ReaderMode): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#ui?.auto.modeChanged();
    if (this.#ui) {
      this.#showMode();
      this.#setCurrent(this.#page, false);
    }
  }

  setRtl(rtl: boolean): void {
    const changed = rtl !== this.#rtl;
    this.#rtl = rtl;
    if (!this.#ui) return;
    this.#ui.direction.value = rtl ? "rtl" : "ltr";
    // A spread's pages swap sides.
    if (changed && this.#mode === "page") this.#ui.pageView.show(this.#visible(this.#page));
  }

  #toggleRtl(): void {
    this.setRtl(!this.#rtl);
    this.#options.onDirectionChange?.(this.#rtl);
  }

  zoomIn(): void {
    this.#setZoom(zoomStep(this.#zoom, this.#currentNatural(), this.#viewport(), 1));
  }
  zoomOut(): void {
    this.#setZoom(zoomStep(this.#zoom, this.#currentNatural(), this.#viewport(), -1));
  }
  actualSize(): void {
    this.#setZoom({ fit: false, scale: 1 });
  }
  fit(): void {
    this.#setZoom(FIT);
  }

  // The real scale of what's on screen.
  #scale(): number {
    return scaleOf(this.#zoom, this.#currentNatural(), this.#viewport());
  }

  // The zoom value: shows the real scale, with a "fit" tag while pages are fitted. Typing a
  // percentage and pressing Enter sets it; dragging sideways on it scrubs the zoom, about 0.4%
  // per pixel, multiplied, so it's as fine near 20% as near 400%.
  #zoomField(doc: Document): Ui["zoom"] {
    const element = doc.createElement("span");
    element.className = "zoom-field";
    const input = doc.createElement("input");
    input.className = "zoom-value";
    input.type = "text";
    input.inputMode = "numeric";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Zoom: type a percentage, or drag sideways to change it");
    input.title = "Type a percentage, or drag sideways";
    const fitTag = doc.createElement("span");
    fitTag.className = "zoom-fit";
    fitTag.textContent = "fit";
    fitTag.title = "Pages fit the window";
    element.append(fitTag, input);

    let scrub: { x: number; scale: number; moved: boolean } | null = null;
    input.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || doc.activeElement === input || input.matches(":focus")) return;
      event.preventDefault(); // no caret until it's clear this isn't a drag
      scrub = { x: event.clientX, scale: this.#scale(), moved: false };
      input.setPointerCapture?.(event.pointerId);
    });
    input.addEventListener("pointermove", (event) => {
      if (!scrub) return;
      const dx = event.clientX - scrub.x;
      if (!scrub.moved && Math.abs(dx) < 3) return;
      scrub.moved = true;
      element.classList.add("scrubbing");
      this.#setZoom({ fit: false, scale: clampScale(scrub.scale * SCRUB_PER_PX ** dx) });
    });
    const endScrub = () => {
      if (!scrub) return;
      const moved = scrub.moved;
      scrub = null;
      element.classList.remove("scrubbing");
      if (moved) return;
      // A click without a drag: type a number.
      input.focus();
      input.select();
    };
    input.addEventListener("pointerup", endScrub);
    input.addEventListener("pointercancel", endScrub);
    const commit = () => {
      const percent = Number.parseFloat(input.value.replace(",", "."));
      if (Number.isFinite(percent) && percent > 0) this.#setZoom({ fit: false, scale: clampScale(percent / 100) });
      else this.#renderZoom();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        commit();
        input.blur();
      } else if (event.key === "Escape") {
        input.blur(); // back to the value as it was
      } else {
        return;
      }
      event.preventDefault();
    });
    input.addEventListener("blur", () => queueMicrotask(() => this.#renderZoom()));
    input.addEventListener("change", commit);
    return { element, input, fitTag };
  }

  // The zoom value: the real scale, and whether pages are fitted.
  #renderZoom(): void {
    const ui = this.#ui;
    if (!ui) return;
    const zoom = this.#zoom;
    // The real scale of what's on screen, so fitted pages say how big they're drawn too.
    // Left alone while it's being typed in.
    if (ui.host.shadowRoot?.activeElement === ui.zoom.input) return;
    ui.zoom.input.value = `${Math.round(this.#scale() * 100)}%`;
    ui.zoom.fitTag.hidden = !zoom.fit;
  }

  toggleHidden(): void {
    if (!this.#ui) return;
    this.#hidden = !this.#hidden;
    if (this.#hidden) this.#ui.auto.stopSilently();
    this.#ui.blank.hidden = !this.#hidden;
  }

  toggleHelp(): void {
    if (!this.#ui) return;
    this.#ui.help.hidden = !this.#ui.help.hidden;
    if (!this.#ui.help.hidden) this.#ui.auto.stopSilently();
  }

  #clamp(page: number): number {
    return Math.min(this.#options.source.pageCount, Math.max(1, Math.round(page) || 1));
  }

  #viewport(): Size {
    const win = this.#options.doc.defaultView;
    return { width: win?.innerWidth || 1, height: win?.innerHeight || 1 };
  }

  // What zoom steps scale: the page on screen, or the spread as a whole.
  #currentNatural(): Size {
    const visible = this.#mode === "page" ? this.#visible(this.#page) : [this.#page];
    return spreadNatural(
      visible.map((page) => {
        const state = this.#ui?.buffer.state(page);
        if (state && "img" in state && state.img.naturalWidth > 0) return { width: state.img.naturalWidth, height: state.img.naturalHeight };
        return this.#options.source.naturalSize(page);
      }),
    );
  }

  #setZoom(zoom: Zoom): void {
    this.#zoom = zoom;
    if (!this.#ui) return;
    this.#renderZoom();
    if (this.#mode === "page") this.#ui.pageView.layout();
    else this.#ui.stripView?.layout();
  }

  // `fromScroll`: strip mode scrolled to this page, so there's nothing to scroll to.
  #setCurrent(page: number, fromScroll: boolean): void {
    const ui = this.#ui;
    if (!ui) return;
    const changed = page !== this.#page;
    this.#page = page;
    const visible = this.#mode === "page" ? this.#visible(page) : [page];
    const count = this.#options.source.pageCount;
    this.#retarget(visible);
    if (this.#mode === "page") ui.pageView.show(visible);
    else if (!fromScroll) ui.stripView?.scrollToPage(page);
    this.#renderZoom(); // a fitted page's scale depends on the page
    ui.indicator.textContent = visible.length > 1 ? `${visible[0]}–${visible.at(-1)} / ${count}` : `${page} / ${count}`;
    ui.progress.style.width = `${Math.round((Math.max(...visible) / count) * 1000) / 10}%`;
    ui.filmstrip?.setCurrent(page);
    ui.grid?.setCurrent(page);
    this.#updateSpreadButtons();
    ui.auto.pageShown(Math.max(...visible), count);
    if (changed) this.#options.history.pageChanged(page);
    this.#options.onPageChange?.(page, visible);
  }

  // Keeps the pages on screen and the preload counts' worth around them loaded.
  #retarget(visible: number[]): void {
    const { preloadAhead, preloadBehind } = this.#options.settings();
    this.#ui?.buffer.retarget(preloadOrder(visible, this.#options.source.pageCount, preloadAhead, preloadBehind), visible.length);
  }

  #showMode(): void {
    const ui = this.#ui!;
    const strip = this.#mode === "strip";
    if (strip && !ui.stripView) {
      // The page it scrolled to counts only in strip mode.
      ui.stripView = new StripView(this.#viewDeps(ui), (page) => {
        if (this.#mode === "strip") this.#setCurrent(page, true);
      });
      this.#attachPan(ui.stripView.element);
      ui.root.append(ui.stripView.element);
      ui.stripView.layout();
    }
    ui.pageView.element.hidden = strip;
    if (ui.stripView) ui.stripView.element.hidden = !strip;
    // Images move to whichever view is showing.
    for (const page of ui.buffer.pages()) this.#refresh(page);
    ui.mode.value = this.#mode;
    this.#updateSpreadButtons();
    (strip ? ui.stripView!.element : ui.pageView.element).focus({ preventScroll: true });
  }

  #refresh(page: number): void {
    const ui = this.#ui;
    if (!ui) return;
    if (this.#mode === "page") ui.pageView.refresh(page);
    else ui.stripView?.refresh(page);
  }

  #onBufferChange(page: number, state: PageState | undefined): void {
    const ui = this.#ui;
    if (!ui) return;
    this.#refresh(page);
    if (state?.status === "loaded" && this.#mode === "strip") ui.stripView?.layoutSoon();
    if (state?.status === "loaded" && this.#visible(this.#page).includes(page)) this.#renderZoom(); // its real size is known now
    // A resolved page knows its real shape, which can change how pages pair.
    if (state?.status === "loading" || state?.status === "loaded") this.#spreadsChanged();
    ui.filmstrip?.setBuffered(ui.buffer.pages());
    ui.grid?.setBuffered(ui.buffer.pages());
  }

  #onThumbPage(): void {
    const ui = this.#ui;
    if (!ui) return;
    ui.stripView?.layoutSoon();
    ui.filmstrip?.update();
    ui.grid?.update();
    this.#spreadsChanged();
  }

  #viewDeps(ui: Pick<Ui, "buffer">): ViewDeps {
    return {
      doc: this.#options.doc,
      source: this.#options.source,
      buffer: ui.buffer,
      viewport: () => this.#viewport(),
      insets: () => this.#insets,
      zoom: () => this.#zoom,
      rtl: () => this.#rtl,
      onRetry: (page) => this.#ui?.buffer.retry(page),
    };
  }

  #build(): Ui {
    this.#setKeys(this.#options.settings(), false);
    const doc = this.#options.doc;
    const win = doc.defaultView;
    const html = doc.documentElement;
    const saved = { scrollX: win?.scrollX ?? 0, scrollY: win?.scrollY ?? 0, overflow: html.style.overflow };
    html.style.overflow = "hidden";

    const host = doc.createElement("div");
    host.id = "eroreader-reader";
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = READER_CSS;
    const root = doc.createElement("div");
    root.className = "reader";
    root.tabIndex = -1;
    shadow.append(style, root);

    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
      const node = doc.createElement(tag);
      node.className = className;
      node.textContent = text;
      return node;
    };
    // The reader's controls come in three kinds, each drawn its own way (see readerStyles):
    // - actions do something and have no state ("action");
    // - toggles switch something on or off, and light up while on ("toggle");
    // - exclusive choices are segmented controls (SegmentedControl).
    // Every button shows its key, in a badge and in its tooltip. An icon's button is named by
    // `name` for screen readers.
    const button = (kind: "action" | "toggle", label: string | Node, id: ActionId, onClick: () => void, name?: string) => {
      const node = el("button", typeof label === "string" ? kind : `${kind} icon-button`);
      node.type = "button";
      if (name) node.setAttribute("aria-label", name);
      if (kind === "toggle") node.setAttribute("aria-pressed", "false");
      const badge = keyBadge(doc, "");
      node.append(label, badge);
      this.#trackBadge(id, node, badge);
      node.addEventListener("click", onClick);
      // No focus on click: a focused button would be pressed again by Space, which strip
      // mode leaves to native scrolling.
      node.addEventListener("mousedown", (event) => event.preventDefault());
      return node;
    };
    // An exclusive choice. Its key flips it, so the key's badge shows on the options; the
    // stylesheet hides it on the chosen one, leaving it on the side the key would switch to.
    // An option shown as an icon is named by its third item.
    const choice = <T extends string>(label: string, id: ActionId, options: [T, string | Node, string?][], value: T, onChange: (value: T) => void) => {
      const control = new SegmentedControl({ doc, label, options: options.map(([v, text]) => ({ value: v, label: text })), value, onChange });
      options.forEach(([v, , name]) => {
        const node = control.buttons.get(v)!;
        if (name) {
          node.setAttribute("aria-label", name);
          node.classList.add("icon-option");
        }
        const badge = keyBadge(doc, "");
        node.append(badge);
        this.#trackBadge(id, node, badge);
        node.addEventListener("mousedown", (event) => event.preventDefault());
      });
      return control;
    };
    const divider = () => el("span", "divider");

    const toolbar = el("div", "toolbar");
    const indicator = el("span", "indicator");
    // Two groups float on their own while the toolbar hides (see readerStyles): where you are
    // in the gallery, always, and the panels' controls while a panel is open.
    const progress = el("span", "");
    const progressTrack = el("span", "tb-progress");
    progressTrack.append(progress);
    const where = el("span", "tb-float tb-where");
    where.append(indicator, progressTrack);
    const mode = choice("Reading mode", "mode", [["page", "Page"], ["strip", "Strip"]], this.#mode, (value) => this.setMode(value));
    const direction = choice("Reading direction", "direction", [["ltr", "LTR"], ["rtl", "RTL"]], this.#rtl ? "rtl" : "ltr", (value) => {
      if ((value === "rtl") !== this.#rtl) this.#toggleRtl();
    });
    const spreadButton = button("toggle", "Spread", "spreads", () => this.#perform("spreads", false));
    spreadButton.setAttribute("aria-pressed", String(this.#spreads));
    const offsetButton = button("toggle", "Pair cover", "offset", () => this.#perform("offset", false));
    const repairButton = button("toggle", "Re-pair", "repair", () => this.#perform("repair", false));
    offsetButton.hidden = repairButton.hidden = true;
    const zoom = this.#zoomField(doc);
    const filmstripButton = button("toggle", icon("filmstrip", doc), "filmstrip", () => this.#perform("filmstrip", false), "Filmstrip");
    const gridButton = button("toggle", icon("grid", doc), "grid", () => this.#perform("grid", false), "Grid");
    // What only matters while they're open, beside them: hover zoom, and where the filmstrip
    // sits (greyed out while it's closed).
    const hoverButton = button("toggle", icon("magnify", doc), "hoverZoom", () => this.#perform("hoverZoom", false), "Hover zoom");
    hoverButton.setAttribute("aria-pressed", String(this.#options.settings().hoverZoom));
    const position = choice<"bottom" | "left">(
      "Filmstrip position",
      "filmstripVertical",
      [["bottom", icon("dockBottom", doc), "Along the bottom"], ["left", icon("dockLeft", doc), "On the left edge"]],
      this.#options.settings().filmstripVertical ? "left" : "bottom",
      () => this.toggleFilmstripVertical(),
    );
    position.disabled = true;
    const panels = el("span", "tb-float tb-panels");
    panels.append(filmstripButton, gridButton, hoverButton, position.element);
    const settingsButton = button("toggle", icon("sliders", doc), "settings", () => this.#perform("settings", false), "Quick settings");
    const quickSettings = new QuickSettings({
      doc,
      settings: () => this.#options.settings(),
      // Applied right away: the stored settings only report back asynchronously.
      save: (patch) => {
        this.#options.saveSettings?.(patch);
        this.applySettings(this.#options.settings());
      },
      openAll: this.#options.openSettings,
    });
    // Left to right, in groups: where you are; how pages show; how big; the panels; the reader's
    // own settings and help. Within a group, its choices (segmented) come before its toggles.
    toolbar.append(
      button("action", "← Gallery", "close", () => this.requestClose()),
      el("span", "title", this.#options.title),
      where,
      divider(),
      mode.element,
      direction.element,
      spreadButton,
      offsetButton,
      repairButton,
      divider(),
      button("action", "−", "zoomOut", () => this.#perform("zoomOut", false), "Zoom out"),
      zoom.element,
      button("action", "+", "zoomIn", () => this.#perform("zoomIn", false), "Zoom in"),
      button("action", "Fit", "fit", () => this.fit()),
      button("action", "1:1", "actualSize", () => this.actualSize()),
      divider(),
      panels,
      divider(),
      settingsButton,
      button("action", "?", "help", () => this.toggleHelp(), "Keyboard shortcuts"),
    );

    const help = el("div", "help");
    help.hidden = true;
    const helpBox = el("div", "help-box");
    const table = doc.createElement("table");
    const autoTable = doc.createElement("table");
    table.className = "help-keys";
    autoTable.className = "help-auto-keys";
    const closeHelp = el("button", "", "Close");
    closeHelp.type = "button";
    closeHelp.title = "Close (Esc)";
    closeHelp.addEventListener("click", () => this.toggleHelp());
    helpBox.append(
      el("h2", "", "Keyboard shortcuts"),
      table,
      el("h3", "", "While hands-free mode runs"),
      el("p", "help-note", "Rest the cursor on the auto pill to start. Higher or lower on its track sets the direction and speed; drag its grab bar to move it."),
      autoTable,
      closeHelp,
    );
    helpBox.addEventListener("click", (event) => event.stopPropagation());
    help.append(helpBox);
    help.addEventListener("click", () => this.toggleHelp());

    const notice = el("div", "notice");
    notice.hidden = true;
    notice.setAttribute("role", "status");

    const blank = el("div", "blank");
    blank.hidden = true;
    blank.addEventListener("dblclick", () => this.toggleHidden());

    const buffer = new ImageBuffer({
      source: this.#options.source,
      onChange: (page, state) => this.#onBufferChange(page, state),
      createImage: this.#options.createImage,
    });
    const auto = new AutoMode({
      doc,
      mode: () => this.#mode,
      viewport: () => this.#viewport(),
      position: () => this.#options.settings().autoZone,
      onMove: (position) => this.#options.saveSettings?.({ autoZone: position }),
      step: (direction) => this.#autoStep(direction),
      scrollBy: (dy) => this.#autoScroll(dy),
      atLastPage: () => this.#visible(this.#page).includes(this.#options.source.pageCount),
      emit: (event) => this.#ui?.voice?.event(event),
      onSpeed: (speed) => this.#ui?.voice?.speed(speed),
      onLastPace: (mode, pace) => this.#options.saveSettings?.({ autoPace: { ...this.#options.settings().autoPace, [mode]: pace } }),
    });
    const voice = this.#options.createVoice?.() ?? null;
    const pageView = new PageView(this.#viewDeps({ buffer }));
    this.#attachPageGestures(pageView.element);
    root.append(toolbar, quickSettings.element, pageView.element, auto.element, ...(voice ? [voice.element] : []), notice, help, blank);
    // A click outside the quick settings closes them, and does nothing else.
    let swallowClick = false;
    root.addEventListener(
      "pointerdown",
      (event) => {
        const target = event.composedPath()[0] as Element | undefined;
        if (!quickSettings.isOpen || quickSettings.element.contains(target as Node) || settingsButton.contains(target as Node)) return;
        this.toggleQuickSettings();
        swallowClick = true;
      },
      true,
    );
    root.addEventListener(
      "click",
      (event) => {
        if (!swallowClick) return;
        swallowClick = false;
        event.stopPropagation();
        event.preventDefault();
      },
      true,
    );
    root.addEventListener("mousemove", (event) => {
      this.#pointerMoved(event);
      const overUi = (event.target as Element | null)?.closest?.(".toolbar, .quick-settings, .thumbs, .help, .voice, .placeholder button, .auto-grab") != null;
      auto.pointer(event.clientX, event.clientY, overUi, event.buttons);
    });
    doc.body.append(host);

    this.#renderHelp(table, autoTable);
    const unsubscribe = this.#options.store.subscribe(() => this.#onThumbPage());
    return {
      host,
      root,
      toolbar,
      indicator,
      progress,
      mode,
      direction,
      zoom,
      spreadButton,
      offsetButton,
      repairButton,
      filmstripButton,
      gridButton,
      hoverButton,
      position,
      settingsButton,
      quickSettings,
      filmstrip: null,
      grid: null,
      help,
      blank,
      notice,
      auto,
      voice,
      pageView,
      stripView: null,
      buffer,
      unsubscribe,
      saved,
    };
  }

  // Drag to pan, in either mode. Returns whether the last press panned, so the click it ends
  // with can be told from a plain click.
  #attachPan(view: HTMLElement): () => boolean {
    let start: { x: number; y: number; left: number; top: number } | null = null;
    let panned = false;
    // Images are draggable by default: Firefox would start its own drag-and-drop of the page
    // and stop sending the pointer events panning needs.
    view.addEventListener("dragstart", (event) => event.preventDefault());
    view.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop };
      panned = false;
    });
    view.addEventListener("pointermove", (event) => {
      if (!start || !(event.buttons & 1)) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!panned && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
      panned = true;
      view.classList.add("panning");
      view.scrollLeft = start.left - dx;
      view.scrollTop = start.top - dy;
    });
    const end = () => {
      start = null;
      view.classList.remove("panning");
    };
    view.addEventListener("pointerup", end);
    view.addEventListener("pointercancel", end);
    return () => {
      const was = panned;
      panned = false;
      return was;
    };
  }

  // Click a side to turn the page; drag to pan a zoomed page.
  #attachPageGestures(stage: HTMLElement): void {
    const panned = this.#attachPan(stage);
    stage.addEventListener("click", (event) => {
      if (panned()) return;
      const rect = stage.getBoundingClientRect();
      const leftSide = event.clientX < rect.left + rect.width / 2;
      if (leftSide !== this.#rtl) this.prev();
      else this.next();
    });
  }

  // Shows the toolbar, hiding it again after `hideAfter` ms unless that's null.
  #showBar(hideAfter: number | null): void {
    const ui = this.#ui;
    if (!ui) return;
    ui.root.classList.remove("bar-hidden");
    if (this.#barTimer !== null) clearTimeout(this.#barTimer);
    this.#barTimer = hideAfter === null ? null : setTimeout(() => {
      this.#barTimer = null;
      this.#ui?.root.classList.add("bar-hidden");
    }, hideAfter);
  }

  #pointerMoved(event: MouseEvent): void {
    const ui = this.#ui;
    if (!ui) return;
    const shown = !ui.root.classList.contains("bar-hidden");
    // On the toolbar while it shows; the floating groups of a hidden one don't count.
    const onBar = shown && (event.target as Element | null)?.closest?.(".toolbar, .quick-settings") != null;
    const edge = Math.max(BAR_EDGE, this.#toolbarHeight / 2);
    if (event.clientY <= edge || onBar || ui.quickSettings.isOpen) this.#showBar(null);
    else if (shown && this.#barTimer === null) this.#showBar(BAR_LEAVE_MS);
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.#hidden) {
      if (event.key.toLowerCase() === "b") this.toggleHidden();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Keys that work a control stay the control's: all of them while typing a zoom value, the
    // arrow keys in a focused segmented control.
    const target = event.composedPath()[0];
    if (target instanceof Element && (target.matches(".zoom-value") || (target.closest(".seg") && event.key.startsWith("Arrow")))) return;
    // Likewise in the quick settings: all keys for a field or slider, Space and Enter for a
    // button.
    if (target instanceof Element && target.closest(".quick-settings") && event.key !== "Escape") {
      if (target.matches("input") || (target.matches("button") && (event.key === " " || event.key === "Enter"))) return;
    }
    if (this.#handleKey(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  #handleKey(event: KeyboardEvent): boolean {
    const key = normalizeKey(event.key);
    const auto = this.#ui?.auto;
    const autoAction = this.#autoActions.find((action) => action.keys.includes(key))?.id;
    if (auto && autoAction === "autoStop" && auto.escape()) return true;
    if (this.quickSettingsOpen && key === "Escape") {
      this.toggleQuickSettings();
      return true;
    }
    if (this.helpOpen && (key === "Escape" || key === "?")) {
      this.toggleHelp();
      return true;
    }
    if (this.gridOpen && key === "Escape") {
      this.toggleGrid();
      return true;
    }
    const id = this.#keymap.get(key);
    return id !== undefined && this.#perform(id, true);
  }

  // Runs an action from a key or a button. Returns false when a key should keep its native
  // behaviour instead, like Space scrolling in strip mode.
  #perform(id: ActionId, fromKey: boolean): boolean {
    const pageMode = this.#mode === "page";
    switch (id) {
      case "right":
        this.#rtl ? this.prev() : this.next();
        return true;
      case "left":
        this.#rtl ? this.next() : this.prev();
        return true;
      case "pageNext":
        if (pageMode) this.next();
        return pageMode || !fromKey;
      case "pagePrev":
        if (pageMode) this.prev();
        return pageMode || !fromKey;
      // The grid covers the page, so these move around the grid instead.
      case "first":
        if (this.gridOpen) this.#ui!.grid!.scrollToStart();
        else this.goTo(1);
        return true;
      case "last":
        if (this.gridOpen) this.#ui!.grid!.scrollToEnd();
        else this.goTo(this.#options.source.pageCount);
        return true;
      case "mode":
        this.setMode(pageMode ? "strip" : "page");
        return true;
      case "spreads":
        this.toggleSpreads();
        return true;
      case "offset":
        this.toggleSpreadOffset();
        return true;
      case "repair":
        this.toggleRepairPoint();
        return true;
      case "direction":
        this.#toggleRtl();
        return true;
      // The grid covers the page, so zooming resizes its thumbnails instead.
      case "zoomIn":
        if (this.gridOpen) this.resizeThumbs(1);
        else this.zoomIn();
        return true;
      case "zoomOut":
        if (this.gridOpen) this.resizeThumbs(-1);
        else this.zoomOut();
        return true;
      case "actualSize":
        this.actualSize();
        return true;
      case "fit":
        this.fit();
        return true;
      case "filmstrip":
        this.toggleFilmstrip();
        return true;
      case "filmstripVertical":
        this.toggleFilmstripVertical();
        return true;
      case "grid":
        this.toggleGrid();
        return true;
      case "thumbsSmaller":
        this.resizeThumbs(-1);
        return true;
      case "thumbsLarger":
        this.resizeThumbs(1);
        return true;
      case "autoPlay":
        this.toggleHandsFree();
        return true;
      case "hoverZoom":
        this.toggleHoverZoom();
        return true;
      case "hide":
        this.toggleHidden();
        return true;
      case "settings":
        this.toggleQuickSettings();
        return true;
      case "help":
        this.toggleHelp();
        return true;
      case "close":
        this.requestClose();
        return true;
    }
  }

  #autoStep(direction: Direction): boolean {
    const before = this.#page;
    if (direction === 1) this.next();
    else this.prev();
    return this.#page !== before;
  }

  #autoScroll(dy: number): boolean {
    const el = this.#ui?.stripView?.element;
    if (!el) return false;
    if (dy > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return false;
    if (dy < 0 && el.scrollTop <= 0) return false;
    this.#scrollRemainder += dy;
    const whole = Math.trunc(this.#scrollRemainder);
    this.#scrollRemainder -= whole;
    if (whole !== 0) el.scrollTop += whole;
    return true;
  }

  // Leaving the window or its losing focus ends a hands-free run steered on the pill; a locked
  // one keeps going. The tab being hidden (another tab, or the window minimized) stops either.
  #onMouseOut = (event: MouseEvent): void => {
    if (event.relatedTarget === null) this.#ui?.auto.leaveWindow();
  };
  #onBlur = (): void => this.#ui?.auto.leaveWindow();
  #onVisibility = (): void => {
    if (this.#options.doc.visibilityState === "hidden") this.#ui?.auto.stopSilently();
  };

  #onResize = (): void => {
    this.#renderZoom();
    this.#updateInsets(false); // the layout below follows them
    this.#ui?.auto.layout();
    if (this.#mode === "page") this.#ui?.pageView.layout();
    else this.#ui?.stripView?.layout();
  };

  #listen(on: boolean): void {
    const win = this.#options.doc.defaultView;
    if (!win) return;
    if (on) {
      win.addEventListener("keydown", this.#onKeyDown, true);
      win.addEventListener("resize", this.#onResize);
      win.addEventListener("blur", this.#onBlur);
      this.#options.doc.addEventListener("mouseout", this.#onMouseOut);
      this.#options.doc.addEventListener("visibilitychange", this.#onVisibility);
    } else {
      win.removeEventListener("keydown", this.#onKeyDown, true);
      win.removeEventListener("resize", this.#onResize);
      win.removeEventListener("blur", this.#onBlur);
      this.#options.doc.removeEventListener("mouseout", this.#onMouseOut);
      this.#options.doc.removeEventListener("visibilitychange", this.#onVisibility);
    }
  }
}

// How wide a hovered thumbnail shows in a view, or null while hover zoom is off.
function hoverOf(settings: Settings, view: ThumbView): number | null {
  return settings.hoverZoom ? hoverWidth(settings.thumbWidth[view], settings.hoverSize[view]) : null;
}

function sameSpreads(a: number[][], b: number[][]): boolean {
  return a.length === b.length && a.every((spread, i) => spread.join() === b[i]!.join());
}
