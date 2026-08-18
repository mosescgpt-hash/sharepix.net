/**
 * Reuse signed S3 URLs instead of minting a new one on every render.
 *
 * A fresh signature means a different query string, and a different query
 * string is a different URL to the browser — so re-signing throws away the
 * cached bytes and downloads the file again. That is invisible for a 40 KB
 * thumbnail and expensive for a video, where every gallery visit was paying
 * full price for a clip the viewer already had.
 *
 * The TTL has to stay comfortably inside the signature's own validity, or a
 * reused URL expires mid-view.
 */

interface Entry {
  url: string;
  signedAt: number;
}

export interface SignedUrlCache {
  get(path: string): Promise<string>;
  /** Drop everything — used when the signer's credentials change. */
  clear(): void;
  size(): number;
}

/**
 * @param sign     produces a fresh signed URL for a storage path
 * @param ttlMs    how long a signature is reused
 * @param maxSize  entries kept before expired ones are swept; a bound so a long
 *                 session on a large event cannot grow the map without limit
 */
export function createSignedUrlCache(
  sign: (path: string) => Promise<string>,
  ttlMs: number,
  maxSize = 2000,
  now: () => number = Date.now,
): SignedUrlCache {
  const entries = new Map<string, Entry>();
  // Calls in flight, so a gallery signing 200 paths at once never signs the
  // same path twice and a re-render mid-flight joins the existing request.
  const pending = new Map<string, Promise<string>>();

  function sweep() {
    const cutoff = now() - ttlMs;
    for (const [path, entry] of entries) {
      if (entry.signedAt <= cutoff) entries.delete(path);
    }
    // Still oversized after dropping the expired ones: evict oldest-first.
    // Map preserves insertion order, so the head is the least recently signed.
    while (entries.size > maxSize) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }

  return {
    async get(path: string): Promise<string> {
      const cached = entries.get(path);
      if (cached && now() - cached.signedAt < ttlMs) return cached.url;

      const inFlight = pending.get(path);
      if (inFlight) return inFlight;

      const request = sign(path)
        .then((url) => {
          entries.set(path, { url, signedAt: now() });
          if (entries.size > maxSize) sweep();
          return url;
        })
        .finally(() => {
          pending.delete(path);
        });

      pending.set(path, request);
      return request;
    },
    clear() {
      entries.clear();
      pending.clear();
    },
    size() {
      return entries.size;
    },
  };
}
