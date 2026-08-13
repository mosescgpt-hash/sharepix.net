import {
  hasClearedBuffer,
  slideshowEligible,
  newArrivals,
  nextIndex,
  LIVE_BUFFER_SECONDS,
} from '../lib/slideshow';
import { QRPhoto } from '../lib/types';

const NOW = new Date('2026-06-01T12:00:00Z');

function photo(overrides: Partial<QRPhoto> & { id: string }): QRPhoto {
  return {
    eventId: 'evt',
    s3Key: `events/evt/photos/${overrides.id}.jpg`,
    createdAt: NOW.toISOString(),
    ...overrides,
  } as QRPhoto;
}

/** A photo created `seconds` before NOW. */
function aged(id: string, seconds: number, overrides: Partial<QRPhoto> = {}): QRPhoto {
  return photo({
    id,
    createdAt: new Date(NOW.getTime() - seconds * 1000).toISOString(),
    ...overrides,
  });
}

describe('moderation buffer', () => {
  it('holds a photo back until it has aged past the buffer', () => {
    expect(hasClearedBuffer(aged('fresh', 5), NOW)).toBe(false);
    expect(hasClearedBuffer(aged('edge', LIVE_BUFFER_SECONDS), NOW)).toBe(true);
    expect(hasClearedBuffer(aged('old', 600), NOW)).toBe(true);
  });

  it('honors a custom buffer length', () => {
    expect(hasClearedBuffer(aged('p', 30), NOW, 60)).toBe(false);
    expect(hasClearedBuffer(aged('p', 90), NOW, 60)).toBe(true);
  });

  it('shows a photo with no usable timestamp rather than hiding it forever', () => {
    expect(hasClearedBuffer(photo({ id: 'none', createdAt: null }), NOW)).toBe(true);
    expect(hasClearedBuffer(photo({ id: 'junk', createdAt: 'not-a-date' }), NOW)).toBe(true);
  });
});

describe('slideshowEligible', () => {
  it('keeps only buffered, approved still images, oldest first', () => {
    const result = slideshowEligible(
      [
        aged('new', 10), // still inside the buffer
        aged('older', 600),
        aged('middle', 300),
        aged('unapproved', 600, { approved: false }),
        aged('clip', 600, { s3Key: 'events/evt/photos/clip.mov' }),
      ],
      NOW,
    );
    expect(result.map((item) => item.id)).toEqual(['older', 'middle']);
  });

  it('excludes videos even when they are old and approved', () => {
    const result = slideshowEligible(
      [aged('v', 900, { s3Key: 'events/evt/photos/party.MOV' })],
      NOW,
    );
    expect(result).toHaveLength(0);
  });

  it('returns nothing when every photo is still inside the buffer', () => {
    expect(slideshowEligible([aged('a', 1), aged('b', 2)], NOW)).toHaveLength(0);
  });
});

describe('newArrivals', () => {
  it('returns only photos the screen has not shown yet, oldest first', () => {
    const eligible = [aged('a', 900), aged('b', 600), aged('c', 300)];
    const seen = new Set(['a']);
    expect(newArrivals(eligible, seen).map((item) => item.id)).toEqual(['b', 'c']);
  });

  it('returns nothing once everything has been seen', () => {
    const eligible = [aged('a', 900)];
    expect(newArrivals(eligible, new Set(['a']))).toHaveLength(0);
  });
});

describe('nextIndex', () => {
  it('advances and wraps at the end of the reel', () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(2, 3)).toBe(0);
  });

  it('stays put when there is nothing to show', () => {
    expect(nextIndex(0, 0)).toBe(0);
  });
});
