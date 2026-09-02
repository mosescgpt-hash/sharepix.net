import { printableKey } from '../amplify/functions/print-checkout/printable';

const EVENT = 'evt-1';
const original = `events/${EVENT}/photos/abc.jpg`;

describe('what a print order may reference', () => {
  it('accepts an original in this event', () => {
    expect(printableKey(original, EVENT)).toEqual({ ok: true });
    expect(printableKey(`events/${EVENT}/photos/nested/deep.heic`, EVENT).ok).toBe(true);
  });

  it('refuses a preview or a thumbnail', () => {
    // These are small re-encodes. Printing an 8x10 from a 1280px preview — or
    // worse, a thumbnail — produces something the customer paid full price for
    // and would only discover on arrival.
    expect(printableKey(`events/${EVENT}/previews/abc-preview.jpg`, EVENT).ok).toBe(false);
    expect(printableKey(`events/${EVENT}/thumbs/abc-thumb.jpg`, EVENT).ok).toBe(false);
  });

  it('refuses another event’s photo', () => {
    expect(printableKey('events/evt-2/photos/abc.jpg', EVENT).ok).toBe(false);
  });

  it('refuses a prefix that merely starts with this event’s id', () => {
    // 'evt-1' is a prefix of 'evt-12'; requiring the trailing slash is what
    // stops one event's order reaching the other's files.
    expect(printableKey('events/evt-12/photos/abc.jpg', EVENT).ok).toBe(false);
  });

  it('refuses traversal and anything outside the events tree', () => {
    for (const key of [
      '../../etc/passwd',
      'events/../secrets/x.jpg',
      `events/${EVENT}/../evt-2/photos/a.jpg`,
      'other/evt-1/photos/a.jpg',
      '',
      '   ',
    ]) {
      expect(printableKey(key, EVENT).ok).toBe(false);
    }
  });

  it('refuses videos, case-insensitively', () => {
    expect(printableKey(`events/${EVENT}/photos/clip.mp4`, EVENT).ok).toBe(false);
    expect(printableKey(`events/${EVENT}/photos/CLIP.MOV`, EVENT).ok).toBe(false);
    expect(printableKey(`events/${EVENT}/photos/clip.3gp`, EVENT).ok).toBe(false);
  });

  it('refuses everything when no event is named', () => {
    expect(printableKey(original, '').ok).toBe(false);
  });

  it('tells a guest what to do, not what broke', () => {
    const wrongEvent = printableKey('events/evt-2/photos/a.jpg', EVENT);
    const video = printableKey(`events/${EVENT}/photos/a.mp4`, EVENT);
    expect(wrongEvent.ok).toBe(false);
    expect(video.ok).toBe(false);
    if (!wrongEvent.ok) expect(wrongEvent.reason).toMatch(/does not belong to this event/);
    if (!video.ok) expect(video.reason).toMatch(/Videos/);
  });
});
