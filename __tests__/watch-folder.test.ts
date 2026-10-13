import {
  MAX_SEND_ATTEMPTS,
  SENT_HISTORY_LIMIT,
  baselineFor,
  fingerprint,
  historyKey,
  isFatalSendError,
  isWatchable,
  mimeForName,
  parseHistory,
  planScan,
  serializeHistory,
  skipReason,
  type FolderEntry,
} from '../lib/watchFolder';
import { MAX_INPUT_BYTES } from '../lib/proProcessing';
import { codeOnly, readSource } from './sourceGuards';

const jpg = (name: string, size = 5_000_000, lastModified = 1_000): FolderEntry => ({
  name,
  size,
  lastModified,
});

describe('which files the watch folder sends', () => {
  it('takes JPEG and PNG, whatever the case of the extension', () => {
    expect(mimeForName('IMG_0001.JPG')).toBe('image/jpeg');
    expect(mimeForName('a.jpeg')).toBe('image/jpeg');
    expect(mimeForName('a.png')).toBe('image/png');
  });

  it('leaves RAW files alone, because a RAW+JPEG camera writes both', () => {
    for (const name of ['IMG_0001.CR3', 'DSC0001.ARW', 'DSC_0001.NEF', 'a.dng', 'a.heic']) {
      expect(isWatchable(jpg(name))).toBe(false);
    }
  });

  it('skips macOS resource forks and temp files that also end in .JPG', () => {
    expect(isWatchable(jpg('._IMG_0001.JPG'))).toBe(false);
    expect(isWatchable(jpg('.hidden.jpg'))).toBe(false);
    expect(isWatchable(jpg('~export.jpg'))).toBe(false);
  });

  it('skips empty files and ones the processor would refuse as too large', () => {
    expect(isWatchable(jpg('a.jpg', 0))).toBe(false);
    expect(isWatchable(jpg('a.jpg', MAX_INPUT_BYTES + 1))).toBe(false);
    expect(isWatchable(jpg('a.jpg', MAX_INPUT_BYTES))).toBe(true);
  });

  it('explains an oversize skip, and says nothing about files it was never meant to send', () => {
    expect(skipReason(jpg('big.jpg', MAX_INPUT_BYTES + 1))).toContain('big.jpg');
    expect(skipReason(jpg('a.CR3', MAX_INPUT_BYTES + 1))).toBeNull();
    expect(skipReason(jpg('a.jpg'))).toBeNull();
  });
});

describe('when a file is ready', () => {
  it('waits for a new file to hold its size across two listings', () => {
    const first = planScan([jpg('a.jpg', 100)], { done: new Set(), lastSizes: new Map() });
    expect(first.ready).toEqual([]);
    expect(first.settling).toBe(1);

    const growing = planScan([jpg('a.jpg', 200)], { done: new Set(), lastSizes: first.lastSizes });
    expect(growing.ready).toEqual([]);

    const settled = planScan([jpg('a.jpg', 200)], { done: new Set(), lastSizes: growing.lastSizes });
    expect(settled.ready.map((e) => e.name)).toEqual(['a.jpg']);
    expect(settled.settling).toBe(0);
  });

  it('never offers a file that was already sent', () => {
    const entry = jpg('a.jpg');
    const plan = planScan([entry], {
      done: new Set([fingerprint(entry)]),
      lastSizes: new Map([['a.jpg', entry.size]]),
    });
    expect(plan.ready).toEqual([]);
  });

  it('treats a re-export under the same name as a new photograph', () => {
    const before = jpg('a.jpg', 100, 1);
    const after = jpg('a.jpg', 120, 2);
    const plan = planScan([after], {
      done: new Set([fingerprint(before)]),
      lastSizes: new Map([['a.jpg', 120]]),
    });
    expect(plan.ready).toEqual([after]);
  });

  it('sends oldest first, so the gallery fills in the order things happened', () => {
    const entries = [jpg('c.jpg', 1, 30), jpg('a.jpg', 1, 10), jpg('b.jpg', 1, 20)];
    const lastSizes = new Map(entries.map((e) => [e.name, e.size]));
    const plan = planScan(entries, { done: new Set(), lastSizes });
    expect(plan.ready.map((e) => e.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });
});

describe('starting to watch', () => {
  it('by default sends only what arrives after Start — the folder may hold last weekend', () => {
    const old = [jpg('a.jpg'), jpg('b.jpg')];
    const done = baselineFor(old, false);
    const plan = planScan([...old, jpg('new.jpg')], {
      done,
      lastSizes: new Map([
        ['a.jpg', old[0].size],
        ['b.jpg', old[1].size],
        ['new.jpg', 5_000_000],
      ]),
    });
    expect(plan.ready.map((e) => e.name)).toEqual(['new.jpg']);
  });

  it('can include what is already there when asked', () => {
    expect(baselineFor([jpg('a.jpg')], true).size).toBe(0);
  });
});

describe('failures', () => {
  it('stops on the authorization answer instead of retrying every file', () => {
    expect(isFatalSendError('That event could not be found.')).toBe(true);
    expect(isFatalSendError('Upload failed (503).')).toBe(false);
    expect(isFatalSendError('Failed to fetch')).toBe(false);
  });

  it('gives up on one file after a bounded number of tries', () => {
    expect(MAX_SEND_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_SEND_ATTEMPTS).toBeLessThanOrEqual(5);
  });
});

describe('remembering what was sent', () => {
  it('is kept per event', () => {
    expect(historyKey('e1')).not.toBe(historyKey('e2'));
  });

  it('survives junk in storage', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('not json')).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory('["a",2,"b"]')).toEqual(['a', 'b']);
  });

  it('keeps the newest entries when over the limit', () => {
    const all = Array.from({ length: SENT_HISTORY_LIMIT + 5 }, (_, i) => `f${i}`);
    const kept = parseHistory(serializeHistory(all));
    expect(kept).toHaveLength(SENT_HISTORY_LIMIT);
    expect(kept[kept.length - 1]).toBe(`f${SENT_HISTORY_LIMIT + 4}`);
    expect(kept[0]).toBe('f5');
  });
});

describe('the watcher component', () => {
  const component = codeOnly(readSource('components/WatchFolderUploader.tsx'));
  const page = codeOnly(readSource('pages/pro/events/[eventId]/review.tsx'));

  it('sends through the same function as Add photos, not a second upload path', () => {
    expect(page).toContain('<WatchFolderUploader eventId={eventId} send={sendOne} onSent={load} />');
    expect(component).not.toContain('requestProUploadSlot');
    expect(component).not.toContain('processProPhoto');
  });

  it('never runs two scans at once, which would send a file twice', () => {
    expect(component).toContain('if (!dir || busyRef.current) return;');
  });

  it('only asks for read access to the folder', () => {
    expect(component).toContain("mode: 'read'");
  });
});
