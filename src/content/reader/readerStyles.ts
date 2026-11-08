// Styles inside the reader's shadow root, so the site's CSS never reaches it.
export const READER_CSS = `
:host { all: initial; }
.reader {
  position: fixed; inset: 0; z-index: 2147483646;
  background: #111; color: #e8e8e8;
  font: 14px/1.4 system-ui, sans-serif;
  outline: none;
}
.toolbar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 5;
  display: flex; align-items: center; gap: 6px; padding: 7px 10px;
  background: rgba(0, 0, 0, 0.75);
  transition: opacity 0.2s;
}
/* Hidden unless pinned (see BAR_EDGE in reader.ts): all but two groups fade with the bar, and
   those stay in place as small floating pills of one style, so nothing moves and a click lands
   where it's aimed. Where you are in the gallery always stays; the panels' controls stay while
   a panel is open. */
.toolbar { transition: background 0.2s; }
.toolbar > * { transition: opacity 0.2s, background 0.2s, box-shadow 0.2s; }
.reader.bar-hidden:not(.pinned) .toolbar { background: transparent; pointer-events: none; }
.reader.bar-hidden:not(.pinned) .toolbar > * { opacity: 0; }
.reader.bar-hidden:not(.pinned) .toolbar > .tb-where,
.reader.bar-hidden.panels-open:not(.pinned) .toolbar > .tb-panels {
  opacity: 1; pointer-events: auto;
  background: rgba(12, 12, 12, 0.85);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}
/* The floating groups: padded into pills, the padding taken back so the bar's layout is the
   same whether they float or not. */
.tb-float { display: inline-flex; align-items: center; gap: 6px; flex: none; padding: 3px 6px; margin: -3px -6px; border-radius: 10px; }
.tb-where { flex-direction: column; align-items: stretch; gap: 2px; padding: 4px 9px 5px; margin: -4px -9px -5px; }
.tb-progress { display: block; height: 2px; border-radius: 1px; background: rgba(255, 255, 255, 0.15); overflow: hidden; }
.tb-progress > span { display: block; height: 100%; width: 0; background: #e26; transition: width 0.2s; }
.placeholder button, .help button {
  white-space: nowrap;
  font: inherit; color: inherit; background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 4px;
  padding: 3px 9px; cursor: pointer;
}
.placeholder button:hover { background: rgba(255, 255, 255, 0.18); }
/* The controls' vocabulary, the same everywhere in the reader:
   - an action does something and has no state: a quiet frame;
   - a toggle is on or off: the same frame, lit in the accent while on;
   - an exclusive choice is a segmented control: a recessed track with a raised thumb that
     slides to the chosen option. */
.action, .toggle {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex: none;
  height: 28px; padding: 0 10px; box-sizing: border-box; border-radius: 6px;
  font: inherit; color: inherit; white-space: nowrap; cursor: pointer;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.16);
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.action:hover:not(:disabled), .toggle:hover:not(:disabled) { background: rgba(255, 255, 255, 0.13); border-color: rgba(255, 255, 255, 0.28); }
.action:active:not(:disabled) { background: rgba(255, 255, 255, 0.2); }
.toggle[aria-pressed="true"] { background: rgba(226, 34, 102, 0.24); border-color: rgba(255, 105, 155, 0.75); color: #ffd2e1; }
.toggle[aria-pressed="true"]:hover { background: rgba(226, 34, 102, 0.34); border-color: #ff6a9b; }
.action:disabled, .toggle:disabled { opacity: 0.35; cursor: default; }
.icon-button { width: 30px; padding: 0; }
.icon-button:has(.key:not([hidden])) { width: auto; padding: 0 8px; }
.action:focus-visible, .toggle:focus-visible, .seg button:focus-visible, .zoom-value:focus-visible { outline: 2px solid #ff6a9b; outline-offset: 1px; }
.seg {
  position: relative; isolation: isolate; flex: none; display: inline-flex; height: 28px; padding: 2px;
  box-sizing: border-box; border-radius: 8px;
  background: rgba(0, 0, 0, 0.5); box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.09);
}
.seg-thumb {
  position: absolute; z-index: -1; top: 2px; bottom: 2px; left: 0; border-radius: 6px;
  background: rgba(255, 255, 255, 0.2); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  transition: transform 0.24s cubic-bezier(0.3, 0.75, 0.25, 1), width 0.24s cubic-bezier(0.3, 0.75, 0.25, 1);
}
.seg-thumb.instant, .seg.dragging .seg-thumb { transition: none; }
.seg:not(.measured) .seg-thumb { display: none; }
.seg:not(.measured) button[aria-checked="true"] { background: rgba(255, 255, 255, 0.2); }
.seg button {
  display: inline-flex; align-items: center; gap: 5px; padding: 0 10px; border: none; border-radius: 6px;
  font: inherit; color: rgba(255, 255, 255, 0.6); background: none; white-space: nowrap; cursor: pointer;
  transition: color 0.15s;
}
.seg button:hover { color: rgba(255, 255, 255, 0.9); }
.seg button[aria-checked="true"] { color: #fff; cursor: grab; }
.seg.dragging, .seg.dragging button { cursor: grabbing; }
.seg.disabled { opacity: 0.35; }
.seg.disabled button { cursor: default; }
/* The key flips the choice, so its badge shows only on the side it would switch to. */
.seg button[aria-checked="true"] .key { display: none; }
.seg button.icon-option { padding: 0 8px; }
@media (prefers-reduced-motion: reduce) { .seg-thumb { transition: none; } }
.action .key, .toggle .key, .seg .key { margin-left: 0; }
.toolbar .divider { flex: none; width: 1px; height: 18px; margin: 0 3px; background: rgba(255, 255, 255, 0.14); }
/* The zoom value: a field showing the real scale. Drag sideways to scrub, click to type. */
.zoom-field {
  position: relative; flex: none; display: inline-flex; align-items: center; height: 28px; box-sizing: border-box;
  border-radius: 6px; background: rgba(0, 0, 0, 0.5); box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.09);
}
.zoom-value {
  width: 4.4em; height: 100%; box-sizing: border-box; padding: 0 6px; margin: 0; border: none; border-radius: 6px;
  font: inherit; font-variant-numeric: tabular-nums; text-align: center; color: inherit; background: none;
  cursor: ew-resize; outline: none;
}
.zoom-value:focus { cursor: text; box-shadow: inset 0 0 0 2px #e26; }
.zoom-field.scrubbing, .zoom-field.scrubbing .zoom-value { cursor: ew-resize; user-select: none; }
.zoom-fit {
  flex: none; margin-left: 6px; padding: 0 4px; border-radius: 4px; pointer-events: none;
  font: 600 9px/15px system-ui, sans-serif; letter-spacing: 0.05em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.75); background: rgba(255, 255, 255, 0.12);
}
.zoom-fit:not([hidden]) + .zoom-value { width: 3.6em; padding-left: 4px; }
.toolbar .icon { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
/* Narrow windows drop the key badges first (tooltips still name the keys), then the title, and
   wrap only as a last resort. */
@media (max-width: 1100px) { .toolbar .key, .thumb-controls .key { display: none; } }
/* The left filmstrip's header is too narrow for badges; the tooltips name the keys. */
.thumbs.filmstrip.vertical .thumb-controls .key { display: none; }
@media (max-width: 900px) { .toolbar { flex-wrap: wrap; } .toolbar .title { display: none; } }
/* The title takes only what's left over, so it shrinks before anything wraps. */
.toolbar .title { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.8; }
.toolbar .indicator { font-variant-numeric: tabular-nums; white-space: nowrap; }
.stage, .strip { position: absolute; inset: 0; overflow: auto; outline: none; }
.stage { display: flex; cursor: default; }
.stage.pannable, .strip.pannable { cursor: grab; }
.stage.panning, .strip.panning { cursor: grabbing; user-select: none; }
.frame { margin: auto; flex: none; display: flex; }
.frame .cell { display: flex; flex: none; }
.frame img, .slot img { display: block; width: 100%; height: 100%; }
.strip-inner { position: relative; margin: 0 auto; }
.slot { position: absolute; display: flex; background: #1a1a1a; }
/* Strip mode's current page: a bar down its left side, just outside the page, or just inside
   when the page reaches the edge of the space (.snug), and its number beside the bar, kept in
   view while the page is (placed by StripView). */
.slot::before {
  content: ""; position: absolute; top: 0; bottom: 0; left: -10px; width: 4px; border-radius: 2px;
  background: #e26; box-shadow: 0 0 10px rgba(226, 34, 102, 0.55);
  pointer-events: none; opacity: 0; transition: opacity 0.2s;
}
.slot.snug::before { left: 4px; }
.slot.current::before { opacity: 1; }
.strip-current {
  position: absolute; z-index: 1; transform: translateX(calc(-100% - 18px)); padding: 1px 7px; border-radius: 9px;
  font: 600 12px/18px system-ui, sans-serif; font-variant-numeric: tabular-nums; color: #fff; background: #e26;
  pointer-events: none;
}
.strip-current.snug { transform: translateX(14px); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5); }
@media (prefers-reduced-motion: reduce) { .slot::before { transition: none; } }
.placeholder {
  margin: auto; padding: 16px; text-align: center; color: #aaa;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.placeholder.limit { color: #f0c36a; }
.thumbs {
  position: absolute; z-index: 3; display: flex;
  background: rgba(10, 10, 10, 0.92);
}
.thumb-scroll { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; }
/* The panels' controls, in groups by purpose (size, view, jump), the groups set apart. */
.thumb-controls { flex: none; display: flex; gap: 6px; padding: 6px; align-items: center; }
.thumb-group, .thumb-row { display: flex; gap: 4px; align-items: center; }
.thumb-controls .divider { flex: none; width: 1px; height: 18px; margin: 0 4px; background: rgba(255, 255, 255, 0.14); }
.thumbs.filmstrip { left: 0; right: 0; bottom: 0; flex-direction: row; }
.thumbs.filmstrip .thumb-scroll {
  display: flex; gap: 6px; padding: 6px 0; overflow-x: auto; overflow-y: hidden;
}
/* Along the bottom, the groups are rows at the strip's end (see filmstripControlRows). */
.thumbs.filmstrip:not(.vertical) .thumb-controls {
  flex-direction: column; align-items: flex-start; justify-content: center; padding: 6px 10px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}
/* On the left edge: the auto zone lives on the right one. */
/* Its width is the header's at least, and room for a thin scrollbar beside the thumbnails,
   which center in it. */
.thumbs.filmstrip.vertical {
  top: 0; bottom: 0; right: auto; flex-direction: column;
  width: max(92px, calc(var(--cell-width) + 20px));
}
/* Below the toolbar, pinned or not, so its floating groups and the toolbar itself never
   cover the grid's top edge or the left filmstrip's header. */
.thumbs.filmstrip.vertical, .thumbs.grid { top: var(--toolbar-height, 0px); }
.thumbs.filmstrip.vertical .thumb-scroll {
  flex-direction: column; align-items: center; padding: 0 6px 6px; overflow-x: hidden; overflow-y: auto;
  scrollbar-width: thin;
}
/* The header: each group a column of two, always 92 px wide in all. */
.thumbs.filmstrip.vertical .thumb-controls {
  order: -1; justify-content: center; gap: 0; padding: 6px 3px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.thumbs.filmstrip.vertical .thumb-group { flex-direction: column; gap: 2px; }
.thumbs.filmstrip.vertical .thumb-controls .action { width: 24px; height: 24px; padding: 0; }
.thumbs.filmstrip.vertical .thumb-controls .divider { height: 40px; margin: 0 3px; }

/* The grid lies over everything but the toolbar, the filmstrip included, whichever opened
   first. What it covers is out of sight while it's open, so nothing shows through its
   backdrop but the page. Its controls run along the bottom: the toolbar covers the top. */
.thumbs.grid { z-index: 4; left: 0; right: 0; bottom: 0; flex-direction: column; }
.reader.grid-open .thumbs.filmstrip, .reader.grid-open .auto-zone { visibility: hidden; }
/* The grid sits centered on its stage, sized by --grid-width and --grid-height, with a handle
   in the gutter on each side, a little apart from it so it's clear of the scrollbar. */
.grid-stage { position: relative; flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; }
.thumbs.grid .thumb-scroll { flex: none; width: var(--grid-width); height: var(--grid-height); }
.grid-handle { position: absolute; z-index: 1; touch-action: none; }
.grid-handle.left, .grid-handle.right { top: calc(50% - var(--grid-height) / 2); height: var(--grid-height); width: 24px; cursor: ew-resize; }
.grid-handle.left { left: calc(50% - var(--grid-width) / 2 - 32px); }
.grid-handle.right { left: calc(50% + var(--grid-width) / 2 + 8px); }
.grid-handle.top, .grid-handle.bottom { left: calc(50% - var(--grid-width) / 2); width: var(--grid-width); height: 24px; cursor: ns-resize; }
.grid-handle.top { top: calc(50% - var(--grid-height) / 2 - 32px); }
.grid-handle.bottom { top: calc(50% + var(--grid-height) / 2 + 8px); }
/* A grip in the middle of each, brighter on hover, with the whole strip faintly lit. */
.grid-handle { border-radius: 8px; transition: background 0.15s; }
.grid-handle:hover, .grid-handle.dragging { background: rgba(255, 255, 255, 0.05); }
.grid-handle::after {
  content: ""; position: absolute; left: 50%; top: 50%; border-radius: 3px;
  background: rgba(255, 255, 255, 0.28); transition: background 0.15s;
}
.grid-handle.left::after, .grid-handle.right::after { width: 6px; height: 96px; margin: -48px 0 0 -3px; }
.grid-handle.top::after, .grid-handle.bottom::after { width: 96px; height: 6px; margin: -3px 0 0 -48px; }
.grid-handle:hover::after, .grid-handle.dragging::after { background: rgba(255, 255, 255, 0.7); }
.thumbs.grid .thumb-scroll {
  display: grid; grid-template-columns: repeat(auto-fill, var(--cell-width)); gap: 12px;
  justify-content: center; align-content: start;
}
.thumbs.grid .thumb-controls { justify-content: center; padding: 6px 16px 8px; }
.thumb-controls .action { height: 26px; font-size: 13px; padding: 0 8px; }
.thumb-controls .icon-button { width: 28px; padding: 0; }
.thumb-controls .icon-button:has(.key:not([hidden])) { width: auto; padding: 0 7px; }
.thumbs .cell, .hover-preview {
  position: relative; flex: none; overflow: hidden; cursor: pointer;
  background: #222; border-radius: 3px; outline-offset: -2px;
}
.thumbs .cell:hover { outline: 2px solid rgba(255, 255, 255, 0.5); }
.thumbs .cell.current, .hover-preview.current { outline: 3px solid #e26; }
/* The current page breathes: the thumbnail itself grows a little and back, in a loop, so it's
   unmistakable wherever the eye comes back to it. A steady, thicker outline with reduced
   motion. */
.thumbs .cell.current { z-index: 1; animation: current-breathe 1.8s ease-in-out infinite; }
@keyframes current-breathe {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(226, 34, 102, 0), 0 0 0 rgba(226, 34, 102, 0); }
  50% { transform: scale(1.07); box-shadow: 0 0 0 4px rgba(226, 34, 102, 0.3), 0 8px 26px rgba(226, 34, 102, 0.5); }
}
@media (prefers-reduced-motion: reduce) {
  .thumbs .cell.current { animation: none; outline-width: 4px; box-shadow: 0 0 0 3px rgba(226, 34, 102, 0.35); }
}
/* The furthest page read has a labelled badge along the top of its thumbnail; the page number
   and the preloaded dot sit along the bottom. The badge steps aside while the thumbnail is
   hovered. */
.thumbs .mark { position: absolute; z-index: 1; pointer-events: none; transition: opacity 0.12s; }
.thumbs .cell:hover .mark { opacity: 0; }
.thumbs .mark.furthest {
  top: 3px; right: 3px; padding: 0 5px; border-radius: 4px;
  font: 600 10px/16px system-ui, sans-serif; color: #2a1b00; background: #f2c14e;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
.thumb-controls .icon { width: 15px; height: 15px; vertical-align: -3px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.thumbs.filmstrip:not(.vertical) .icon.along { transform: rotate(-90deg); }
.thumbs .cell.buffered::after {
  content: ""; position: absolute; bottom: 5px; right: 5px; width: 7px; height: 7px;
  border-radius: 50%; background: #6c6;
}
.thumbs .sprite, .hover-preview .sprite { position: absolute; transform-origin: 0 0; overflow: hidden; }
.thumbs .sprite img, .hover-preview .sprite img { position: absolute; max-width: none; pointer-events: none; }
.thumbs .number, .hover-preview .number {
  position: absolute; left: 3px; bottom: 2px; padding: 0 3px; border-radius: 2px;
  font-size: 11px; background: rgba(0, 0, 0, 0.6);
}
.hover-preview {
  position: absolute; z-index: 1; pointer-events: none; transform-origin: 0 0;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.7);
  transition: transform 0.15s ease-out;
}
.quick-settings {
  position: absolute; top: 44px; right: 10px; z-index: 6; width: 300px;
  max-height: calc(100% - 64px); overflow: auto; box-sizing: border-box;
  padding: 4px 14px 12px; border-radius: 8px;
  background: rgba(24, 24, 24, 0.97); border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6);
}
.qs-section { padding: 8px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.qs-section:last-child { border-bottom: none; }
.qs-section h3 {
  margin: 4px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: #9a9a9a;
}
.qs-row { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.qs-label { flex: 1 1 auto; white-space: nowrap; }
.qs-row input[type="range"] { width: 100px; accent-color: #e26; }
.qs-value { min-width: 44px; text-align: right; font-variant-numeric: tabular-nums; color: #bbb; }
.quick-settings .action { height: 26px; padding: 0 10px; }
.quick-settings .seg { height: 26px; }
.qs-stepper { display: inline-flex; align-items: center; gap: 4px; }
.qs-stepper .qs-value { min-width: 22px; text-align: center; color: inherit; }
.qs-stepper .action { width: 28px; padding: 0; }
/* A row whose control takes the panel's width, under its label. */
.qs-row.qs-stack { flex-direction: column; align-items: stretch; gap: 6px; padding: 4px 0 6px; }
.quick-settings .hs-scale, .quick-settings .hs-width { width: auto; }
/* Hover sizing (HoverSizeControl): multiplier, added width and a width of its own, each line
   led by a radio button and a short tag in one fixed-width column. The line that counts is
   checked and in the accent; the others' controls are dimmed, their sliders grey and their
   remembered choice only outlined. */
.hover-size { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.hs-line { display: flex; align-items: center; gap: 8px; transition: opacity 0.15s; }
/* Only a dimmed line's own control dims: its radio and tag stay as they are, unselected but
   plainly there to click. */
.hs-line > :not(.hs-head) { transition: opacity 0.15s; }
.hs-line.hs-off > :not(.hs-head) { opacity: 0.45; }
.hs-line.hs-off:hover > :not(.hs-head) { opacity: 0.75; }
.hs-head { flex: none; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.hs-radio { flex: none; width: 14px; height: 14px; margin: 0; accent-color: #e26; cursor: pointer; }
.hs-tag {
  width: 32px; font: 600 10px/1 ui-monospace, monospace; letter-spacing: 0.04em;
  color: #d0d0d0; transition: color 0.15s;
}
.hs-line:not(.hs-off) .hs-tag { color: #ff9cc0; }
.hs-scale, .hs-width { flex: 1 1 auto; min-width: 0; margin: 0; accent-color: #e26; }
.hs-off .hs-scale, .hs-off .hs-width { accent-color: #8a8a8a; }
.hs-value { flex: none; min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; }
.hover-size .seg { height: 26px; }
.hover-size .seg button { padding: 0 7px; font-size: 13px; }
.hs-off .seg-thumb { background: none; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3); }
/* The custom amount, typed in its own segment: raised like the chosen one while it counts. */
.hs-custom-box {
  display: inline-flex; align-items: center; gap: 2px; padding: 0 6px; border-radius: 6px;
  font-size: 13px; color: #fff; cursor: text;
  background: rgba(255, 255, 255, 0.2); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}
.hs-off .hs-custom-box { background: none; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3); }
.hs-custom {
  width: 4.2ch; height: 18px; box-sizing: content-box; padding: 0 2px; margin: 0; border: none; border-radius: 4px;
  font: inherit; font-variant-numeric: tabular-nums; text-align: right; color: inherit;
  background: rgba(0, 0, 0, 0.35); appearance: textfield; -moz-appearance: textfield;
}
.hs-custom::-webkit-inner-spin-button, .hs-custom::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.hs-custom:focus { outline: 1px solid #ff6a9b; }
.qs-wide { width: 100%; }
.qs-all { margin-top: 8px; }
.qs-switch {
  appearance: none; position: relative; flex: none; width: 34px; height: 20px; margin: 0;
  border-radius: 10px; background: rgba(255, 255, 255, 0.2); cursor: pointer; transition: background 0.15s;
}
.qs-switch::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform 0.15s;
}
.qs-switch:checked { background: #e26; }
.qs-switch:checked::after { transform: translateX(14px); }
label.qs-row { cursor: pointer; }
.key {
  display: inline-block; margin-left: 5px; padding: 0 4px; border-radius: 3px;
  font: 10px/1.5 ui-monospace, monospace; vertical-align: 1px;
  border: 1px solid rgba(255, 255, 255, 0.3); background: rgba(255, 255, 255, 0.1); opacity: 0.85;
}
.notice {
  position: absolute; top: 52px; left: 50%; transform: translateX(-50%); z-index: 6;
  max-width: min(640px, 90%); padding: 8px 14px; border-radius: 6px;
  background: rgba(0, 0, 0, 0.85); border: 1px solid #444; text-align: center;
  pointer-events: none;
}
.help {
  position: absolute; inset: 0; z-index: 5; display: flex;
  background: rgba(0, 0, 0, 0.8);
}
.help-box {
  margin: auto; max-height: 90%; overflow: auto; padding: 16px 20px;
  background: #1c1c1c; border: 1px solid #333; border-radius: 8px;
}
.help h2 { margin: 0 0 10px; font-size: 16px; }
.help table { border-collapse: collapse; }
.help td { padding: 3px 10px 3px 0; vertical-align: top; }
.help kbd {
  display: inline-block; padding: 0 5px; margin-right: 4px; border-radius: 3px;
  border: 1px solid #555; background: #2a2a2a; font: 12px/1.6 ui-monospace, monospace;
}
.auto-zone {
  position: absolute; z-index: 3; display: flex; flex-direction: column;
  border-radius: 20px; background: rgba(20, 8, 14, 0.6);
  border: 1px solid rgba(255, 122, 168, 0.3);
  opacity: 0.4; transition: opacity 0.3s, box-shadow 0.3s;
}
.auto-zone.near { opacity: 0.85; box-shadow: 0 0 14px rgba(238, 34, 102, 0.35); }
.auto-zone.active, .auto-zone.dragging { opacity: 1; box-shadow: 0 0 18px rgba(238, 34, 102, 0.55); }
/* Its height comes from PILL.grab. Three grip lines in the middle. */
.auto-grab {
  position: relative; flex: none; cursor: grab; border-radius: 20px 20px 0 0;
  background:
    linear-gradient(rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.5)) center calc(50% - 4px) / 22px 1px no-repeat,
    linear-gradient(rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.5)) center 50% / 22px 1px no-repeat,
    linear-gradient(rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.5)) center calc(50% + 4px) / 22px 1px no-repeat;
  border-bottom: 1px solid rgba(255, 122, 168, 0.2);
  touch-action: none;
}
.auto-grab:hover { background-color: rgba(255, 255, 255, 0.06); }
/* A little more to grab, just above the pill. */
.auto-grab::before { content: ""; position: absolute; left: 0; right: 0; top: -8px; height: 8px; }
.auto-zone.dragging .auto-grab { cursor: grabbing; }
/* Square at both ends, between the caps, so the gauge and its scale run to the very ends. */
.auto-track { position: relative; flex: none; overflow: hidden; }
/* The bottom cap: flat against the track, rounded below, AUTO raised on it. */
.auto-cap {
  flex: none; display: flex; align-items: center; justify-content: center; cursor: grab;
  border-radius: 0 0 20px 20px; border-top: 1px solid rgba(255, 122, 168, 0.2);
  font: 800 9px/1 system-ui, sans-serif; letter-spacing: 0.22em; text-indent: 0.22em;
  color: rgba(255, 196, 218, 0.6);
  text-shadow: 0 -1px 0 rgba(255, 255, 255, 0.22), 0 1px 1px rgba(0, 0, 0, 0.75);
  touch-action: none; user-select: none;
}
.auto-cap:hover { background-color: rgba(255, 255, 255, 0.06); }
.auto-zone.dragging .auto-cap { cursor: grabbing; }
.auto-dead { position: absolute; left: 0; right: 0; background: rgba(255, 255, 255, 0.07); }
/* The liquid fills the track's whole width. */
.gauge {
  position: absolute; left: 0; right: 0; height: 0;
  background: linear-gradient(to right, rgba(226, 34, 102, 0.85), rgba(255, 122, 168, 0.85), rgba(226, 34, 102, 0.85));
  box-shadow: inset 0 0 8px rgba(255, 255, 255, 0.25);
}
.auto-zone.locked .gauge { animation: gauge-pulse 1.6s ease-in-out infinite; }
@keyframes gauge-pulse { 50% { opacity: 0.55; } }
.auto-scale { position: absolute; inset: 0; pointer-events: none; }
.auto-scale .tick { position: absolute; left: 0; right: 0; height: 0; }
.auto-scale .tick::before, .auto-scale .tick::after {
  content: ""; position: absolute; top: 0; width: 5px; height: 1px; background: rgba(255, 255, 255, 0.5);
}
.auto-scale .tick::before { left: 0; }
.auto-scale .tick::after { right: 0; }
.auto-scale .tick.major::before, .auto-scale .tick.major::after { width: 9px; background: rgba(255, 255, 255, 0.8); }
.notch-label {
  position: absolute; left: 0; right: 0; transform: translateY(-50%);
  text-align: center; font: 600 10px/1 system-ui, sans-serif; color: #fff;
  text-shadow: 0 0 3px #000, 0 0 2px #000;
}
.auto-track .lock-icon {
  position: absolute; left: 50%; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px;
  color: #fff; filter: drop-shadow(0 0 2px #000); display: none;
}
.auto-zone.locked .auto-track .lock-icon { display: block; }
.voice {
  position: absolute; top: 52px; right: 64px; z-index: 6; pointer-events: none;
  max-width: min(420px, 60%); padding: 10px 14px; border-radius: 14px;
  background: rgba(30, 10, 20, 0.88); border: 1px solid rgba(255, 122, 168, 0.5);
  color: #ffe3ee; transform-origin: top right;
  transition: max-width 0.4s ease, padding 0.4s ease, border-radius 0.4s ease, font-size 0.4s ease;
}
.voice.toast { animation: voice-in 0.35s ease-out; font-size: 15px; }
.voice.pill { max-width: 200px; padding: 3px 10px; border-radius: 999px; font-size: 12px; white-space: nowrap; }
.voice .voice-action { color: #ff9cc0; font-style: italic; }
.voice .lock-icon { width: 11px; height: 11px; margin-right: 5px; vertical-align: -1px; color: #ffd1e1; }
@keyframes voice-in { from { opacity: 0; transform: translateY(-6px) scale(0.96); } }
.help h3 { margin: 14px 0 4px; font-size: 14px; }
.help-note { margin: 0 0 6px; opacity: 0.8; }
.blank { position: absolute; inset: 0; z-index: 10; background: #000; }
[hidden] { display: none !important; }
`;
