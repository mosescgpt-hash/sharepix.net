import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_SEND_ATTEMPTS,
  WATCH_INTERVAL_MS,
  baselineFor,
  fingerprint,
  historyKey,
  isFatalSendError,
  mimeForName,
  parseHistory,
  planScan,
  serializeHistory,
  skipReason,
  type FolderEntry,
} from '@/lib/watchFolder';
import { keepScreenAwake, type ScreenWakeLock } from '@/lib/wakeLock';

/**
 * Watch a folder on this computer and send each new photograph to the event.
 *
 * The rules — what counts as new, when a file has finished being written, what
 * is skipped — are in lib/watchFolder.ts. This holds the folder handle, the
 * timer, and the screen.
 */

// The File System Access API is not in TypeScript's DOM library yet, so the
// small part of it used here is declared locally rather than pulling in a
// types package for three methods.
interface WatchedFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}
interface WatchedDirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<WatchedFileHandle | { kind: 'directory'; name: string }>;
}
type DirectoryPicker = (options?: { mode?: 'read'; id?: string }) => Promise<WatchedDirectoryHandle>;

function directoryPicker(): DirectoryPicker | null {
  if (typeof window === 'undefined') return null;
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return typeof picker === 'function' ? picker.bind(window) : null;
}

async function listFolder(
  dir: WatchedDirectoryHandle,
): Promise<{ entries: FolderEntry[]; handles: Map<string, WatchedFileHandle> }> {
  const entries: FolderEntry[] = [];
  const handles = new Map<string, WatchedFileHandle>();
  // Top level only. Tether software and Lightroom export into one folder; a
  // recursive walk would also pick up a "Selects" or "Rejected" subfolder the
  // photographer made on purpose.
  for await (const handle of dir.values()) {
    if (handle.kind !== 'file' || mimeForName(handle.name) === null) continue;
    const file = await (handle as WatchedFileHandle).getFile().catch(() => null);
    if (!file) continue;
    entries.push({ name: handle.name, size: file.size, lastModified: file.lastModified });
    handles.set(handle.name, handle as WatchedFileHandle);
  }
  return { entries, handles };
}

function readHistory(eventId: string): string[] {
  try {
    return parseHistory(window.localStorage.getItem(historyKey(eventId)));
  } catch {
    return [];
  }
}

function writeHistory(eventId: string, done: Set<string>) {
  try {
    window.localStorage.setItem(historyKey(eventId), serializeHistory(done));
  } catch {
    // Private window or full storage. Duplicates are still prevented for as
    // long as the page stays open, which is the case that matters.
  }
}

interface Props {
  eventId: string;
  /** Slot, PUT, process for one file. Throws with a readable message on failure. */
  send: (file: File, contentType: string) => Promise<void>;
  /** Called after a scan that sent at least one photo, to refresh the queue. */
  onSent: () => Promise<void> | void;
}

export default function WatchFolderUploader({ eventId, send, onSent }: Props) {
  // Decided after mount: the server render has no window, and guessing there
  // would flash the wrong message on every load.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [includeExisting, setIncludeExisting] = useState(false);
  const [sent, setSent] = useState(0);
  const [settling, setSettling] = useState(0);
  const [sending, setSending] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [problem, setProblem] = useState('');

  const dirRef = useRef<WatchedDirectoryHandle | null>(null);
  const doneRef = useRef<Set<string>>(new Set());
  // Only what actually reached the event. This, not doneRef, is what is saved:
  // files skipped because they were already in the folder at Start must stay
  // sendable if the photographer later ticks "also send what is already there".
  const sentRef = useRef<Set<string>>(new Set());
  const sizesRef = useRef<Map<string, number>>(new Map());
  const attemptsRef = useRef<Map<string, number>>(new Map());
  const busyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeRef = useRef<ScreenWakeLock | null>(null);

  useEffect(() => {
    setSupported(directoryPicker() !== null);
  }, []);

  const note = useCallback((line: string) => {
    setNotes((current) => [line, ...current].slice(0, 5));
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    void wakeRef.current?.release();
    wakeRef.current = null;
    setWatching(false);
    setSettling(0);
    setSending(null);
  }, []);

  useEffect(() => stop, [stop]);

  const tick = useCallback(async () => {
    const dir = dirRef.current;
    // One scan at a time. A slow upload outlasts the interval, and a second
    // scan starting underneath it would send the same file twice.
    if (!dir || busyRef.current) return;
    busyRef.current = true;
    let sentThisScan = 0;
    try {
      let listing;
      try {
        listing = await listFolder(dir);
      } catch {
        setProblem('That folder cannot be read any more. Choose it again to carry on.');
        stop();
        return;
      }

      for (const entry of listing.entries) {
        const reason = skipReason(entry);
        if (reason && !doneRef.current.has(fingerprint(entry))) {
          doneRef.current.add(fingerprint(entry));
          note(reason);
        }
      }

      const plan = planScan(listing.entries, {
        done: doneRef.current,
        lastSizes: sizesRef.current,
      });
      sizesRef.current = plan.lastSizes;
      setSettling(plan.settling);

      for (const entry of plan.ready) {
        if (!timerRef.current) break;
        const handle = listing.handles.get(entry.name);
        const file = await handle?.getFile().catch(() => null);
        // Changed since the listing: it is still being written, or was
        // replaced. The next scan will see it settle.
        if (!file || file.size !== entry.size || file.lastModified !== entry.lastModified) continue;

        const key = fingerprint(entry);
        setSending(entry.name);
        try {
          await send(file, mimeForName(entry.name) ?? 'image/jpeg');
          doneRef.current.add(key);
          sentRef.current.add(key);
          writeHistory(eventId, sentRef.current);
          attemptsRef.current.delete(key);
          sentThisScan += 1;
          setSent((n) => n + 1);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'That did not upload.';
          if (isFatalSendError(message)) {
            setProblem(`${message} Watching has stopped.`);
            stop();
            return;
          }
          const attempts = (attemptsRef.current.get(key) ?? 0) + 1;
          attemptsRef.current.set(key, attempts);
          if (attempts >= MAX_SEND_ATTEMPTS) {
            doneRef.current.add(key);
            note(`${entry.name} did not upload after ${attempts} tries: ${message}`);
          }
          // Venue wifi drops for everything at once. Stop this scan and let
          // the next one retry, rather than burning an attempt on every file.
          break;
        } finally {
          setSending(null);
        }
      }
    } finally {
      busyRef.current = false;
      if (sentThisScan > 0) await Promise.resolve(onSent()).catch(() => null);
    }
  }, [eventId, note, onSent, send, stop]);

  async function chooseAndStart() {
    const picker = directoryPicker();
    if (!picker) return;
    setProblem('');
    let dir: WatchedDirectoryHandle;
    try {
      dir = await picker({ mode: 'read', id: 'sharepix-watch-folder' });
    } catch {
      // Cancelled the picker, or refused permission. Nothing to say.
      return;
    }

    let entries: FolderEntry[];
    try {
      entries = (await listFolder(dir)).entries;
    } catch {
      setProblem('That folder could not be read. Try another one.');
      return;
    }

    dirRef.current = dir;
    sentRef.current = new Set(readHistory(eventId));
    doneRef.current = new Set([
      ...Array.from(sentRef.current),
      ...Array.from(baselineFor(entries, includeExisting)),
    ]);
    sizesRef.current = new Map();
    attemptsRef.current = new Map();
    setFolderName(dir.name);
    setSent(0);
    setNotes([]);
    setWatching(true);

    // Keep the screen, and so the laptop, awake. A sleeping laptop sends
    // nothing, and nobody notices until the gallery stops filling.
    wakeRef.current = await keepScreenAwake();

    timerRef.current = setInterval(() => void tick(), WATCH_INTERVAL_MS);
    void tick();
  }

  if (supported === null) return null;

  return (
    <div className="mt-4 border border-dashed border-charcoal/25 p-4">
      <p className="text-sm font-medium">Watch a folder</p>
      {!supported ? (
        <p className="mt-2 text-xs text-charcoal/55">
          Open this page in Chrome or Edge on a laptop to send photos automatically from a
          folder — your tether or Lightroom export folder, for example. This browser
          cannot read folders.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-charcoal/55">
            Pick the folder your camera or Lightroom saves JPEGs into. Each new photo is
            sent as soon as it has finished saving, oldest first. RAW files are left
            alone. Keep this tab open; if it is in the background, Chrome may only check
            about once a minute.
          </p>

          {watching ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm" role="status">
                <span aria-hidden className="mr-2 inline-block h-2 w-2 rounded-full bg-pine" />
                Watching <span className="font-medium">{folderName}</span> · {sent} sent
                {sending ? ` · sending ${sending}` : settling > 0 ? ` · ${settling} saving` : ''}
              </p>
              <button
                type="button"
                onClick={stop}
                className="border border-charcoal/30 px-4 py-2 text-sm font-medium transition hover:border-charcoal/60"
              >
                Stop watching
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <button type="button" onClick={() => void chooseAndStart()} className="spx-btn-ink">
                {folderName ? 'Choose a folder again' : 'Choose a folder'}
              </button>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeExisting}
                  onChange={(e) => setIncludeExisting(e.target.checked)}
                />
                Also send photos already in it
              </label>
            </div>
          )}

          {problem ? <p className="mt-3 text-sm text-red-700">{problem}</p> : null}
          {notes.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-charcoal/60">
              {notes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
