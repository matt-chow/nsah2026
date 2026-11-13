// Decoded display images, loaded on first request only (no preloading of all epochs).
// shortcut: bounded FIFO, not LRU; upgrade if blink sets exceed MAX_ENTRIES.
const MAX_ENTRIES = 12;
const cache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(url: string): Promise<HTMLImageElement> {
  const hit = cache.get(url);
  if (hit) return hit;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  const p = img.decode().then(
    () => img,
    (err: unknown) => {
      cache.delete(url); // allow retry after a failed request
      throw err;
    },
  );
  cache.set(url, p);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return p;
}
