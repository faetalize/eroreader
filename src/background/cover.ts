// Covers for the history: fetched from the browser's HTTP cache when it still has them
// (the gallery page just showed the cover), and shrunk to a small thumbnail.

export const COVER_WIDTH = 150;
export const COVER_MAX_HEIGHT = 220;
export const COVER_TARGET_BYTES = 15 * 1024;

export async function fetchCover(url: string, fetchFn: typeof fetch = fetch): Promise<Blob> {
  // force-cache: from the HTTP cache when it's there, else one request with the normal session.
  const response = await fetchFn(url, { cache: "force-cache", credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status} for the cover`);
  return response.blob();
}

// Shrinks to COVER_WIDTH wide, as WebP (JPEG where WebP can't be written), lowering the
// quality once if the result is still large.
export async function shrinkCover(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, COVER_WIDTH / bitmap.width, COVER_MAX_HEIGHT / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const encode = async (quality: number) => {
    const webp = await canvas.convertToBlob({ type: "image/webp", quality });
    return webp.type === "image/webp" ? webp : canvas.convertToBlob({ type: "image/jpeg", quality });
  };
  const first = await encode(0.8);
  return first.size <= COVER_TARGET_BYTES ? first : encode(0.6);
}
