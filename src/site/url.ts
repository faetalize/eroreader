// Which kind of site page a URL is.

export type PageKind =
  | { kind: "gallery"; gid: number; token: string }
  | { kind: "image" }
  | { kind: "listing" }
  | { kind: "other" };

const GALLERY = /^\/g\/(\d+)\/([0-9a-f]+)\/?$/;
const LISTING = /^\/(?:|tag\/.+|uploader\/.+|favorites\.php|popular|watched)$/;

export function pageKind(url: URL): PageKind {
  const path = url.pathname;
  const gallery = GALLERY.exec(path);
  if (gallery) return { kind: "gallery", gid: Number(gallery[1]), token: gallery[2]! };
  if (path.startsWith("/s/")) return { kind: "image" };
  if (LISTING.test(path)) return { kind: "listing" };
  return { kind: "other" };
}
