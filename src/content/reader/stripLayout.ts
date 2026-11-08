// Where each page sits in strip mode: one column, top to bottom.
import type { Size } from "./zoom";

export const STRIP_GAP = 4;

export interface StripLayout {
  tops: number[]; // index 0 is page 1
  heights: number[];
  widths: number[];
  total: number;
}

export function stripLayout(sizes: Size[], gap = STRIP_GAP): StripLayout {
  const tops: number[] = [];
  let y = 0;
  for (const size of sizes) {
    tops.push(y);
    y += size.height + gap;
  }
  return {
    tops,
    heights: sizes.map((s) => s.height),
    widths: sizes.map((s) => s.width),
    total: Math.max(0, y - gap),
  };
}

// 1-based page whose slot holds `y`, or the nearest page when `y` falls in a gap or outside.
export function pageAt(layout: StripLayout, y: number): number {
  let low = 0;
  let high = layout.tops.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (layout.tops[mid]! <= y) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}
