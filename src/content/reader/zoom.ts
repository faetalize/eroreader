// How big a page is drawn: fitted to the viewport, or at a scale of its real size.

export interface Size {
  width: number;
  height: number;
}

export type Zoom = { fit: true } | { fit: false; scale: number };

export const FIT: Zoom = { fit: true };
export const ZOOM_STEP = 1.25;
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

// Scale at which the whole page is visible. Small pages are scaled up too.
export function fitScale(natural: Size, viewport: Size): number {
  return Math.min(viewport.width / natural.width, viewport.height / natural.height);
}

export function scaleOf(zoom: Zoom, natural: Size, viewport: Size): number {
  return zoom.fit ? fitScale(natural, viewport) : zoom.scale;
}

export function displaySize(natural: Size, viewport: Size, zoom: Zoom): Size {
  const scale = scaleOf(zoom, natural, viewport);
  return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) };
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

// One zoom step in or out from the size the page has now.
export function zoomStep(zoom: Zoom, natural: Size, viewport: Size, direction: 1 | -1): Zoom {
  const scale = scaleOf(zoom, natural, viewport) * ZOOM_STEP ** direction;
  return { fit: false, scale: clampScale(scale) };
}

// Pages side by side at a common height: the first page's.
export function spreadNatural(pages: Size[]): Size {
  const height = pages[0]?.height ?? 1;
  return { width: pages.reduce((sum, page) => sum + (page.width * height) / page.height, 0), height };
}

// Each page's drawn size when the spread as a whole is zoomed like one page.
export function spreadDisplay(pages: Size[], viewport: Size, zoom: Zoom): Size[] {
  const natural = spreadNatural(pages);
  const scale = scaleOf(zoom, natural, viewport);
  return pages.map((page) => ({
    width: Math.round(((page.width * natural.height) / page.height) * scale),
    height: Math.round(natural.height * scale),
  }));
}
