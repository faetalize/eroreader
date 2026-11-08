// Styles for everything the extension adds to site pages. They inherit the site's colors, so
// they fit both E-Hentai's light theme and ExHentai's dark one.

const CSS = `
/* The progress banner. It takes the site's colours: the page's text colour (--erb-fg) and the
   background behind the banner (--erb-bg), both read when it's drawn. The primary button
   swaps them. */
.eroreader-banner { container: erb / inline-size; max-width: 760px; margin: 10px auto; font-size: 10pt; text-align: left; }
.erb-inner {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "status actions" "bar bar";
  align-items: center; gap: 10px 18px; padding: 12px 14px; border-radius: 10px;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  background: color-mix(in srgb, currentColor 5%, transparent);
}
.erb-status { grid-area: status; margin: 0; min-width: 0; display: flex; align-items: baseline; gap: 12px; white-space: nowrap; overflow: hidden; }
.erb-headline { font-size: 12pt; font-weight: 700; }
.erb-detail { display: inline-flex; align-items: center; gap: 6px; opacity: 0.75; overflow: hidden; text-overflow: ellipsis; }
.erb-swatch { flex: none; width: 12px; height: 6px; border-radius: 3px; background: color-mix(in srgb, currentColor 38%, transparent); }
.erb-bar { grid-area: bar; position: relative; height: 6px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, currentColor 13%, transparent); }
.erb-fill, .erb-fill-furthest { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; }
.erb-fill-furthest { background: color-mix(in srgb, currentColor 38%, transparent); }
.erb-fill { background: currentColor; }
.erb-actions { grid-area: actions; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.erb-actions button, .erb-menu button {
  font: inherit; color: inherit; cursor: pointer; margin: 0; border-radius: 6px; line-height: 1.3;
}
.erb-actions .erb-primary { padding: 6px 16px; font-weight: 700; border: none; color: var(--erb-bg, #fff); background: var(--erb-fg, #333); }
.erb-actions .erb-primary:hover { filter: brightness(1.12) contrast(1.05); }
.erb-secondary { padding: 5px 12px; background: transparent; border: 1px solid color-mix(in srgb, currentColor 45%, transparent); }
.erb-secondary:hover, .erb-quiet:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
.erb-quiet { padding: 5px 10px; background: transparent; border: 1px solid transparent; }
.erb-more { position: relative; }
.erb-actions .erb-more-button { width: 32px; padding: 3px 0; font-size: 13pt; line-height: 1; letter-spacing: 1px; }
.erb-more-button[aria-expanded="true"] { background: color-mix(in srgb, currentColor 14%, transparent); }
.erb-menu {
  position: absolute; z-index: 10; top: calc(100% + 6px); right: 0; min-width: 190px; padding: 4px;
  display: flex; flex-direction: column; border-radius: 8px; color: inherit;
  background: var(--erb-bg, Canvas); color: var(--erb-fg, CanvasText); border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}
.erb-menu[hidden] { display: none; }
.erb-item { display: block; width: 100%; padding: 7px 12px; text-align: left; background: transparent; border: none; }
.erb-item:hover, .erb-item:focus-visible { background: color-mix(in srgb, currentColor 12%, transparent); outline: none; }
/* Red, mixed with the site's text colour so it stays readable on light and dark themes. */
.erb-menu .erb-danger { color: color-mix(in srgb, #e5484d 75%, currentColor); }
.erb-menu .erb-menu-show { display: none; }
.eroreader-banner button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
/* Narrow: the bar under the status, the actions on their own line, Resume taking the room. */
@container erb (max-width: 640px) {
  .erb-inner { grid-template-columns: minmax(0, 1fr); grid-template-areas: "status" "bar" "actions"; }
  .erb-actions .erb-primary { flex: 1 1 auto; }
}
/* Narrowest: Show on page moves into the menu. */
@container erb (max-width: 380px) {
  .erb-actions .erb-show { display: none; }
  .erb-menu .erb-menu-show { display: block; }
}
#gdt a.eroreader-last-read, #gdt a.eroreader-furthest { position: relative; }
#gdt a.eroreader-last-read > div { outline: 3px solid #e26; outline-offset: -3px; }
/* Still being read: the thumbnail itself breathes, so it's found at a glance. A steady,
   thicker outline with reduced motion. */
#gdt a.eroreader-last-read.eroreader-reading > div { position: relative; z-index: 1; animation: eroreader-breathe 1.8s ease-in-out infinite; }
@keyframes eroreader-breathe {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(226, 34, 102, 0); }
  50% { transform: scale(1.06); box-shadow: 0 0 0 4px rgba(226, 34, 102, 0.3), 0 8px 24px rgba(0, 0, 0, 0.35); }
}
@media (prefers-reduced-motion: reduce) {
  #gdt a.eroreader-last-read.eroreader-reading > div { animation: none; outline-width: 5px; }
}
/* Labels on the marked thumbnails, stepping aside while the thumbnail is hovered. */
#gdt a.eroreader-last-read::before, #gdt a.eroreader-furthest::after {
  position: absolute; top: 6px; z-index: 2; padding: 1px 6px; border-radius: 4px; pointer-events: none;
  font: 600 11px/16px system-ui, sans-serif; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45); transition: opacity 0.12s;
}
#gdt a.eroreader-last-read::before { content: "Last read"; left: 6px; color: #fff; background: #e22266; }
#gdt a.eroreader-furthest::after { content: "Furthest"; right: 6px; color: #2a1b00; background: #f2c14e; }
#gdt a.eroreader-last-read:hover::before, #gdt a.eroreader-furthest:hover::after { opacity: 0; }
#gdt[aria-busy="true"] { opacity: 0.5; transition: opacity 0.2s; }

/* Listing pages */
.eroreader-host { position: relative; }
.eroreader-badge {
  display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 3px;
  font: bold 9pt/1.5 sans-serif; color: #fff; background: rgba(226, 34, 102, 0.9);
}
.eroreader-badge.overlay { position: absolute; top: 4px; left: 4px; margin: 0; z-index: 2; pointer-events: none; }
.eroreader-finished { opacity: 0.45; transition: opacity 0.2s; }
.eroreader-finished:hover { opacity: 1; }
.eroreader-finished .eroreader-badge { background: rgba(60, 140, 60, 0.9); }
.eroreader-scrub {
  position: absolute; inset: 0; z-index: 3; overflow: hidden; pointer-events: none;
  background: #111;
}
.eroreader-scrub-sprite { position: absolute; transform-origin: 0 0; background-repeat: no-repeat; }
.eroreader-scrub-label {
  position: absolute; right: 4px; bottom: 6px; padding: 0 5px; border-radius: 3px;
  font: bold 9pt/1.5 sans-serif; color: #fff; background: rgba(0, 0, 0, 0.7);
}
.eroreader-scrub-bar { position: absolute; left: 0; bottom: 0; height: 3px; background: #e26; }
img.eroreader-released { visibility: hidden; }
.eroreader-more { clear: both; text-align: center; padding: 12px; opacity: 0.8; }
.eroreader-more button { font: inherit; cursor: pointer; }
.eroreader-searches {
  position: absolute; z-index: 1000; max-width: 640px; padding: 3px 0;
  background: #fff; color: #222; border: 1px solid #888; border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3); font: 10pt/1.5 sans-serif; text-align: left;
}
.eroreader-searches .item { display: flex; gap: 10px; justify-content: space-between; padding: 2px 10px; cursor: pointer; }
.eroreader-searches .item:hover, .eroreader-searches .item.active { background: #e8e1d3; }
.eroreader-searches .note { opacity: 0.6; white-space: nowrap; }
.eroreader-searches.dark { background: #34353b; color: #f1f1f1; border-color: #555; }
.eroreader-searches.dark .item:hover, .eroreader-searches.dark .item.active { background: #4f535b; }
`;

export function injectStyles(doc: Document): void {
  if (doc.getElementById("eroreader-styles")) return;
  const style = doc.createElement("style");
  style.id = "eroreader-styles";
  style.textContent = CSS;
  doc.head.append(style);
}
