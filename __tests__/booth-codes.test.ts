import { readFileSync } from 'fs';
import {
  GUEST_UPLOAD_MESSAGES,
  MAX_GUEST_UPLOADS,
  START_STATE,
  cleanCategoryName,
  destinationOfScan,
  guestUploadRefusal,
  isControlPayload,
  makeControlCode,
  markerLabel,
  markerToScanId,
  parseCategories,
  photoFieldsFor,
  readControlCode,
  routeStream,
  stateAfterScan,
  step,
  uploadsAfterScan,
  type Marker,
} from '../amplify/functions/process-pro-photo/boothControl';
import { isOfflineBoothPayload } from '../amplify/functions/process-pro-photo/boothDivider';
import { boothGroups } from '../lib/boothGroups';

const SECRET = 'test-only-not-a-real-key';
const EV = 'event-1';
const ann: Marker = { kind: 'person', attendeeId: 'a1', name: 'Ann' };
const bob: Marker = { kind: 'person', attendeeId: 'b2', name: 'Bob' };
const sat: Marker = { kind: 'category', categoryId: 'AAAAAAAA', categoryName: 'Saturday' };

describe('start and stop codes: signing', () => {
  const event = makeControlCode(SECRET, EV, { kind: 'e', id: '-' });
  const stop = makeControlCode(SECRET, EV, { kind: 's', id: '-' });
  const cat = makeControlCode(SECRET, EV, { kind: 'c', id: 'AAAAAAAA' });

  it('reads its own codes back', () => {
    expect(readControlCode(SECRET, EV, event)).toEqual({ kind: 'e', id: '-' });
    expect(readControlCode(SECRET, EV, stop)).toEqual({ kind: 's', id: '-' });
    expect(readControlCode(SECRET, EV, cat)).toEqual({ kind: 'c', id: 'AAAAAAAA' });
    expect(isControlPayload(event)).toBe(true);
    // The divider finder treats them as booth codes too.
    expect(isOfflineBoothPayload(event)).toBe(true);
  });

  it('refuses a code from another event', () => {
    expect(readControlCode(SECRET, 'event-2', event)).toBeNull();
  });

  it('refuses changed or made-up codes', () => {
    expect(readControlCode(SECRET, EV, event.replace('.e.', '.s.'))).toBeNull();
    expect(readControlCode(SECRET, EV, cat.replace('AAAAAAAA', 'BBBBBBBB'))).toBeNull();
    expect(readControlCode(SECRET, EV, 'SPK1.e.-.AAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
    expect(readControlCode(SECRET, EV, `${event}x`)).toBeNull();
    expect(readControlCode('another-key', EV, event)).toBeNull();
    expect(readControlCode('', EV, event)).toBeNull();
    expect(readControlCode(SECRET, EV, 'hello')).toBeNull();
  });

  it('never puts the event id or key in the code', () => {
    expect(event).not.toContain(EV);
    expect(event).not.toContain(SECRET);
  });
});

describe('start and stop codes: the sequence', () => {
  it('event, person, another person, event again, stop, category', () => {
    const r = routeStream([
      { photo: 'p0' },
      { scan: { kind: 'event' } },
      { photo: 'p1' },
      { scan: ann },
      { photo: 'p2' },
      { scan: bob },
      { photo: 'p3' },
      { scan: { kind: 'event' } },
      { photo: 'p4' },
      { scan: { kind: 'stop' } },
      { photo: 'p5' },
      { scan: sat },
      { photo: 'p6' },
      { scan: ann },
      { photo: 'p7' },
      { scan: { kind: 'stop' } },
      { scan: bob },
      { photo: 'p8' },
      { scan: { kind: 'unreadable' } },
      { photo: 'p9' },
    ]);
    expect(r.get('p0')).toEqual({ to: 'nobody' });
    expect(r.get('p1')).toEqual({ to: 'event' });
    expect(r.get('p2')).toMatchObject({ to: 'person', attendeeId: 'a1', categoryId: null });
    expect(r.get('p3')).toMatchObject({ to: 'person', attendeeId: 'b2' });
    expect(r.get('p4')).toEqual({ to: 'event' });
    expect(r.get('p5')).toEqual({ to: 'stopped' });
    expect(r.get('p6')).toMatchObject({ to: 'category', categoryId: 'AAAAAAAA' });
    // A person during a category is labelled with it.
    expect(r.get('p7')).toMatchObject({ to: 'person', attendeeId: 'a1', categoryName: 'Saturday' });
    // Stop, then a person's code: carries on with that person.
    expect(r.get('p8')).toMatchObject({ to: 'person', attendeeId: 'b2', categoryId: null });
    expect(r.get('p9')).toEqual({ to: 'nobody' });
  });

  it('stores and rebuilds each scan', () => {
    for (const m of [{ kind: 'event' } as Marker, { kind: 'stop' } as Marker, sat, ann]) {
      const { dest } = step(START_STATE, m);
      const row = { attendeeId: markerToScanId(m) ?? 'none', name: markerLabel(m), categoryId: null, categoryName: 'Saturday' };
      expect(destinationOfScan(row).to).toBe(dest.to);
    }
    expect(markerLabel(sat)).toBe('Start: Saturday');
    const after = stateAfterScan({ to: 'category', categoryId: 'AAAAAAAA', categoryName: 'Saturday' }, START_STATE);
    expect(step(after, ann).dest).toMatchObject({ categoryId: 'AAAAAAAA' });
  });

  it('maps each destination to photo fields; only people get recipients', () => {
    expect(photoFieldsFor({ to: 'event' })).toMatchObject({ boothSegment: 'event', attendeeIds: [] });
    expect(photoFieldsFor({ to: 'stopped' })).toMatchObject({ boothSegment: 'stopped', attendeeIds: [] });
    expect(photoFieldsFor({ to: 'nobody' })).toMatchObject({ boothSegment: 'unsorted', boothMatch: 'unassigned' });
    expect(photoFieldsFor(step(START_STATE, ann).dest)).toMatchObject({ boothSegment: 'person', attendeeIds: ['a1'] });
  });
});

describe('categories', () => {
  it('cleans names and drops bad rows', () => {
    expect(cleanCategoryName('  Day   one ')).toBe('Day one');
    expect(cleanCategoryName('')).toBeNull();
    expect(cleanCategoryName('x'.repeat(41))).toBeNull();
    expect(parseCategories('[{"id":"AAAAAAAA","name":"Sat"},{"id":"bad","name":"x"},{"id":"AAAAAAAA","name":"dup"}]')).toEqual([
      { id: 'AAAAAAAA', name: 'Sat' },
    ]);
    expect(parseCategories('not json')).toEqual([]);
    expect(parseCategories(null)).toEqual([]);
  });
});

describe('guest uploads', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(500)]);
  it('needs a scanned code, open uploads, room, and a JPEG', () => {
    const ok = { sessionAt: '2026-10-25T10:00:00Z', uploadsClosed: false, count: 0, bytes: jpeg };
    expect(guestUploadRefusal(ok)).toBeNull();
    expect(guestUploadRefusal({ ...ok, sessionAt: null })).toBe('not-scanned');
    expect(guestUploadRefusal({ ...ok, uploadsClosed: true })).toBe('closed');
    expect(guestUploadRefusal({ ...ok, count: MAX_GUEST_UPLOADS })).toBe('limit');
    expect(guestUploadRefusal({ ...ok, bytes: Buffer.from('GIF89a'.padEnd(200)) })).toBe('bad-file');
    expect(guestUploadRefusal({ ...ok, bytes: Buffer.alloc(800 * 1024, 0xff) })).toBe('bad-file');
    expect(GUEST_UPLOAD_MESSAGES.closed).toBe('Uploads for this event are closed. Thanks for sharing!');
  });

  it('stop closes uploads; a start reopens them unless the host closed them', () => {
    const open = { closed: false, by: null } as const;
    const stopped = uploadsAfterScan(open, { to: 'stopped' });
    expect(stopped).toEqual({ closed: true, by: 'stop' });
    expect(uploadsAfterScan(stopped, { to: 'event' })).toEqual({ closed: false, by: null });
    expect(uploadsAfterScan(stopped, { to: 'category', categoryId: 'AAAAAAAA', categoryName: 'S' })).toEqual({ closed: false, by: null });
    // A person's code does not reopen.
    expect(uploadsAfterScan(stopped, step(START_STATE, ann).dest)).toEqual(stopped);
    const host = { closed: true, by: 'host' } as const;
    expect(uploadsAfterScan(host, { to: 'event' })).toEqual(host);
    expect(uploadsAfterScan(host, { to: 'stopped' })).toEqual(host);
  });
});

describe('sort groups with start and stop codes', () => {
  it('shows event, category, person, stopped and unsorted', () => {
    const m = new Map([
      ['e', { attendeeIds: [], attendeeNames: [], match: 'event', segment: 'event' }],
      ['c', { attendeeIds: [], attendeeNames: [], match: 'event', segment: 'category', categoryId: 'AAAAAAAA', categoryName: 'Saturday' }],
      ['p', { attendeeIds: ['a1'], attendeeNames: ['Ann'], match: 'qr', segment: 'person' }],
      ['s', { attendeeIds: [], attendeeNames: [], match: 'stopped', segment: 'stopped' }],
      ['u', { attendeeIds: [], attendeeNames: [], match: 'unassigned', segment: 'unsorted' }],
      ['d', { attendeeIds: [], attendeeNames: [], match: 'divider' }],
    ]);
    const g = boothGroups(['e', 'c', 'p', 's', 'u', 'd'], m, [{ attendeeId: 'a1', name: 'Ann' }]);
    expect(g.map((x) => [x.key, x.photoIds])).toEqual([
      ['none', ['u']],
      ['event', ['e']],
      ['cat:AAAAAAAA', ['c']],
      ['a1', ['p']],
      ['stopped', ['s']],
      ['dividers', ['d']],
    ]);
  });
});

describe('the shared module', () => {
  it('is byte-identical in every function that uses it', () => {
    const a = readFileSync('amplify/functions/process-pro-photo/boothControl.ts', 'utf8');
    expect(readFileSync('amplify/functions/booth-scan/boothControl.ts', 'utf8')).toBe(a);
    expect(readFileSync('amplify/functions/booth-gallery/boothControl.ts', 'utf8')).toBe(a);
  });

  it('keeps the signing key out of client code', () => {
    for (const f of ['components/BoothCodes.tsx', 'components/BoothGuestUpload.tsx', 'lib/api.ts']) {
      expect(readFileSync(f, 'utf8')).not.toContain('BOOTH_PRIVATE_KEY');
    }
  });
});
