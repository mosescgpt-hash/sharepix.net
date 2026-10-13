/**
 * The rules behind the watch-folder uploader on the pro review page.
 *
 * ## What it is
 *
 * A photographer shooting tethered — or using their camera maker's transfer
 * app, or exporting from Lightroom as they go — ends up with a folder on a
 * laptop that fills with JPEGs during the event. The watch folder points the
 * review page at that folder and sends each new photograph as it appears,
 * through the same slot → PUT → process steps as "Add photos".
 *
 * ## Why in the browser and not a desktop app
 *
 * docs/pro-uploader.md says an uploader "signs in as that photographer, and can
 * do exactly what the web dashboard can do". The dashboard already is signed in
 * as that photographer, so a page that reads a folder needs no new credential,
 * no API key, no installer and no backend. Chrome and Edge on a laptop can read
 * a folder the person picks (the File System Access API); Safari and Firefox
 * cannot, and the page says so rather than offering a button that fails.
 *
 * ## Why polling
 *
 * There is no "file added" event for a folder in a browser. Listing it every
 * few seconds is cheap — names, sizes and dates, never the bytes — and a few
 * seconds is far below the time a photo takes to reach the gallery anyway.
 *
 * Everything here is pure so the decisions can be tested without a browser.
 */

import { MAX_INPUT_BYTES } from './proProcessing';

/** How often the folder is listed. */
export const WATCH_INTERVAL_MS = 3000;

/** Give up on a file after this many failed sends, rather than retrying it forever. */
export const MAX_SEND_ATTEMPTS = 3;

/**
 * How many sent-file fingerprints are remembered per event. A long wedding is a
 * couple of thousand frames; this leaves room without letting the list grow
 * without bound in somebody's browser storage.
 */
export const SENT_HISTORY_LIMIT = 10_000;

/** What a listing of the folder gives us for one file, before reading it. */
export interface FolderEntry {
  name: string;
  size: number;
  lastModified: number;
}

/**
 * One string that identifies one version of one file.
 *
 * Name alone is not enough: cameras restart numbering, and two cards can both
 * hold IMG_0001.JPG. Size and modified time together tell those apart, and a
 * re-export of the same photograph is a different file the photographer meant
 * to send.
 */
export function fingerprint(entry: FolderEntry): string {
  return `${entry.name}|${entry.size}|${entry.lastModified}`;
}

/** The type to send for a file name, or null for anything the processor cannot read. */
export function mimeForName(name: string): 'image/jpeg' | 'image/png' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  return null;
}

/**
 * Whether a file in the folder is a photograph this uploader should send.
 *
 * Skips hidden files — macOS writes `._IMG_0001.JPG` beside every file on a
 * FAT-formatted card, and those end in .JPG too — and anything that is not a
 * JPEG or PNG, which is where RAW files go: a camera set to RAW+JPEG puts both
 * in the folder, and only the JPEG can be made into a preview.
 */
export function isWatchable(entry: FolderEntry): boolean {
  if (!entry.name || entry.name.startsWith('.') || entry.name.startsWith('~')) return false;
  if (mimeForName(entry.name) === null) return false;
  return entry.size > 0 && entry.size <= MAX_INPUT_BYTES;
}

/** Why a file was left alone, for the one line the page shows about it. */
export function skipReason(entry: FolderEntry): string | null {
  if (!entry.name || entry.name.startsWith('.') || entry.name.startsWith('~')) return null;
  if (mimeForName(entry.name) === null) return null;
  if (entry.size > MAX_INPUT_BYTES) {
    return `${entry.name} is over ${Math.round(MAX_INPUT_BYTES / (1024 * 1024))} MB, so it was skipped.`;
  }
  return null;
}

export interface ScanState {
  /** Fingerprints already sent, or deliberately not sent. Never sent again. */
  done: ReadonlySet<string>;
  /**
   * Size seen for each name on the previous listing. A file is only sent once
   * its size has held still across two listings: a camera or Lightroom writes
   * a large JPEG over a second or two, and reading it mid-write would send
   * half a photograph.
   */
  lastSizes: ReadonlyMap<string, number>;
}

export interface ScanResult {
  /** Settled, new, sendable — in the order they should go. */
  ready: FolderEntry[];
  /** The size map to carry into the next listing. */
  lastSizes: Map<string, number>;
  /** How many new files are still being written. */
  settling: number;
}

/**
 * Decide, from one listing of the folder, what to send now.
 *
 * Oldest first, so the gallery fills in the order the photographs were taken
 * and a backlog after a dropped connection drains the way the photographer
 * expects.
 */
export function planScan(entries: readonly FolderEntry[], state: ScanState): ScanResult {
  const lastSizes = new Map<string, number>();
  const ready: FolderEntry[] = [];
  let settling = 0;

  for (const entry of entries) {
    if (!isWatchable(entry)) continue;
    if (state.done.has(fingerprint(entry))) continue;
    lastSizes.set(entry.name, entry.size);
    if (state.lastSizes.get(entry.name) === entry.size) {
      ready.push(entry);
    } else {
      settling += 1;
    }
  }

  ready.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name));
  return { ready, lastSizes, settling };
}

/**
 * The fingerprints to mark done when the photographer starts watching.
 *
 * By default only photographs that arrive after pressing Start are sent: the
 * folder may hold last weekend's wedding. "Also send what is already there"
 * starts from an empty set instead.
 */
export function baselineFor(
  entries: readonly FolderEntry[],
  includeExisting: boolean,
): Set<string> {
  if (includeExisting) return new Set();
  return new Set(entries.filter(isWatchable).map(fingerprint));
}

/**
 * Whether a send failure should stop the watch rather than be retried.
 *
 * The server answers every authorization failure with the same sentence (see
 * docs/pro-uploader.md). Once that happens, the photographer has been removed
 * from the event or signed out, and retrying every file would only repeat it.
 */
export function isFatalSendError(message: string): boolean {
  return /could not be found/i.test(message) || /not (signed|logged) in/i.test(message);
}

/** The localStorage key holding what has been sent to one event from this browser. */
export function historyKey(eventId: string): string {
  return `spx.pro.watch.${eventId}`;
}

/** Read stored history, tolerating anything a person or an older version left there. */
export function parseHistory(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Serialize history, keeping the newest entries when it is over the limit. */
export function serializeHistory(done: Iterable<string>, limit = SENT_HISTORY_LIMIT): string {
  const all = Array.from(done);
  return JSON.stringify(all.length > limit ? all.slice(all.length - limit) : all);
}
