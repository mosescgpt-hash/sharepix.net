/**
 * Content hashing used to spot duplicate uploads.
 *
 * Guests re-pick the same pictures constantly: a second sweep through the
 * camera roll, a reloaded tab, a retry after the venue Wi-Fi drops. Hashing the
 * bytes gives a photo an identity that survives renaming and re-encoding of the
 * filename, so the same picture can be recognised before any of it is sent.
 */

/** Where a file's hash was already seen, if anywhere. */
export type DuplicateKind = 'none' | 'gallery' | 'batch';

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 of a file's bytes as lowercase hex, or null when this browser cannot
 * hash it. A null hash simply turns duplicate detection off for that file — the
 * upload still goes through.
 */
export async function hashFileContent(file: Blob): Promise<string | null> {
  // WebCrypto exists only in a secure context (HTTPS or localhost).
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;

  try {
    const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
    return toHex(digest);
  } catch {
    // Reading a 100 MB video into memory can fail on an older phone. Losing the
    // hash only costs duplicate detection, so let the upload continue.
    return null;
  }
}

/**
 * Whether a file's hash was already uploaded to this gallery, or already
 * appears earlier in the batch the guest just picked.
 */
export function classifyDuplicate(
  hash: string | null | undefined,
  galleryHashes: ReadonlySet<string>,
  batchHashes: ReadonlySet<string>,
): DuplicateKind {
  if (!hash) return 'none';
  if (galleryHashes.has(hash)) return 'gallery';
  if (batchHashes.has(hash)) return 'batch';
  return 'none';
}

/** Wording shown next to a skipped file, or null when the file is not a duplicate. */
export function duplicateMessage(kind: DuplicateKind): string | null {
  if (kind === 'gallery') return 'Already in this gallery, so it was skipped.';
  if (kind === 'batch') return 'Same as another file you just picked, so it was skipped.';
  return null;
}
