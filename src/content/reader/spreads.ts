// Two-page spreads: which pages show together in page mode.

// Pages grouped into spreads, in reading order.
// - The cover (page 1) stands alone, unless `offset` pairs it with page 2.
// - A wide page (already a scanned double spread) stands alone.
// - A re-pair point flips the pairing from that page on: a page that would start a pair
//   stands alone instead, and a page that would end one starts the next pair instead.
export function computeSpreads(pageCount: number, isWide: (page: number) => boolean, offset: boolean, repairPoints: Iterable<number>): number[][] {
  const points = new Set(repairPoints);
  const spreads: number[][] = [];
  let page = 1;
  if (!offset && pageCount >= 1) {
    spreads.push([1]);
    page = 2;
  }
  let flipped = false; // the point at `page` already took effect by ending the previous spread early
  while (page <= pageCount) {
    if (points.has(page) && !flipped) {
      spreads.push([page]);
      page++;
      continue;
    }
    flipped = false;
    if (page === pageCount || isWide(page) || isWide(page + 1)) {
      spreads.push([page]);
      page++;
    } else if (points.has(page + 1)) {
      spreads.push([page]);
      page++;
      flipped = true;
    } else {
      spreads.push([page, page + 1]);
      page += 2;
    }
  }
  return spreads;
}

export class SpreadIndex {
  readonly spreads: number[][];
  readonly #indexOf: Int32Array; // page → index of its spread

  constructor(spreads: number[][], pageCount: number) {
    this.spreads = spreads;
    this.#indexOf = new Int32Array(pageCount + 1);
    spreads.forEach((spread, i) => spread.forEach((page) => (this.#indexOf[page] = i)));
  }

  of(page: number): number[] {
    return this.spreads[this.#indexOf[page] ?? 0] ?? [page];
  }

  next(page: number): number[] | null {
    return this.spreads[(this.#indexOf[page] ?? 0) + 1] ?? null;
  }

  prev(page: number): number[] | null {
    const index = (this.#indexOf[page] ?? 0) - 1;
    return index >= 0 ? this.spreads[index]! : null;
  }
}
