// Cards far off screen let go of their cover image and keep their size, and get it back as
// they come near, so long infinite-scroll sessions don't keep every cover decoded.
const SRC = "eroreaderSrc"; // data-eroreader-src holds a released image's URL
const RELEASED = "eroreader-released";

export const RELEASE_MARGIN = "300% 0px"; // about three screens above and below

export function releaseImage(img: HTMLImageElement): void {
  const src = img.getAttribute("src");
  if (!src) return;
  // Keep the size the image had, for covers without an inline size.
  if (!img.style.width || !img.style.height) {
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      img.style.width = `${rect.width}px`;
      img.style.height = `${rect.height}px`;
    }
  }
  img.dataset[SRC] = src;
  img.removeAttribute("src");
  img.classList.add(RELEASED); // hidden, so no alt text shows in the gap
}

export function restoreImage(img: HTMLImageElement): void {
  const src = img.dataset[SRC];
  if (!src) return;
  img.src = src;
  delete img.dataset[SRC];
  img.classList.remove(RELEASED);
}

type ObserverFactory = (callback: IntersectionObserverCallback, options: IntersectionObserverInit) => Pick<IntersectionObserver, "observe" | "disconnect">;

export class ImageReleaser {
  readonly #observer: Pick<IntersectionObserver, "observe" | "disconnect">;

  constructor(factory: ObserverFactory = (callback, options) => new IntersectionObserver(callback, options)) {
    this.#observer = factory(
      (entries) => {
        for (const entry of entries) {
          for (const img of entry.target.querySelectorAll("img")) {
            if (img.closest(".gldown")) continue; // the torrent icon stays
            if (entry.isIntersecting) restoreImage(img);
            else releaseImage(img);
          }
        }
      },
      { rootMargin: RELEASE_MARGIN },
    );
  }

  observe(card: Element): void {
    this.#observer.observe(card);
  }

  disconnect(): void {
    this.#observer.disconnect();
  }
}
