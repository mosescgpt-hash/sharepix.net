import {
  DEMO_EVENT,
  DEMO_EVENT_ID,
  DEMO_PHOTOS,
  DEMO_PHOTO_COUNT,
  DEMO_SLIDE_MS,
  demoImage,
  nextSlide,
} from '../lib/demoEvent';

describe('the demo photos', () => {
  it('produces a full grid', () => {
    expect(DEMO_PHOTOS).toHaveLength(DEMO_PHOTO_COUNT);
    expect(DEMO_PHOTO_COUNT).toBeGreaterThanOrEqual(8);
  });

  it('gives every photo a self-contained image', () => {
    // Inline SVG, so the demo needs no network, no CDN and no stock licence.
    for (const photo of DEMO_PHOTOS) {
      expect(photo.url.startsWith('data:image/svg+xml,')).toBe(true);
      expect(photo.url.length).toBeGreaterThan(100);
    }
  });

  it('has no fallback url, because there is no second copy', () => {
    for (const photo of DEMO_PHOTOS) {
      expect(photo.fallbackUrl).toBeUndefined();
    }
  });

  it('gives every photo a unique id, as the grid keys on it', () => {
    expect(new Set(DEMO_PHOTOS.map((p) => p.id)).size).toBe(DEMO_PHOTOS.length);
  });

  it('shapes keys like real ones, so key parsers behave normally', () => {
    for (const photo of DEMO_PHOTOS) {
      expect(photo.s3Key.startsWith(`events/${DEMO_EVENT_ID}/photos/`)).toBe(true);
    }
  });

  it('spreads the photos over time, so sorting by time does something', () => {
    const times = DEMO_PHOTOS.map((p) => new Date(p.createdAt ?? '').getTime());
    expect(new Set(times).size).toBe(times.length);
    for (const time of times) expect(Number.isFinite(time)).toBe(true);
  });

  it('credits several different guests, with some uploading more than once', () => {
    // A gallery where every photo says the same name doesn't show the point —
    // and one where every photo has a DIFFERENT name makes sorting by uploader
    // look useless. Real events sit in between.
    const names = DEMO_PHOTOS.map((p) => p.uploadedBy);
    const unique = new Set(names);
    expect(unique.size).toBeGreaterThan(3);
    expect(unique.size).toBeLessThan(names.length);
  });

  it('shows every photo as approved, so none is hidden as under review', () => {
    for (const photo of DEMO_PHOTOS) expect(photo.approved).toBe(true);
  });
});

describe('the generated imagery', () => {
  it('varies between tiles', () => {
    const urls = new Set(DEMO_PHOTOS.map((p) => p.url));
    expect(urls.size).toBe(DEMO_PHOTOS.length);
  });

  it('escapes its contents, so a label cannot break the data URI', () => {
    const url = demoImage(0, 'Cake & "sparklers" <3');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    // Encoded, not raw — a raw quote or angle bracket would corrupt the SVG.
    expect(url).not.toMatch(/[<>"]/);
  });

  it('is deterministic, so the page does not reshuffle on every render', () => {
    expect(demoImage(3, 'Toasts')).toBe(demoImage(3, 'Toasts'));
  });
});

describe('the demo event', () => {
  it('never looks expired, however long the page is up', () => {
    // A demo that starts showing "this gallery has closed" is worse than none.
    const farFuture = new Date('2090-01-01').getTime();
    expect(new Date(DEMO_EVENT.accessExpiresAt ?? '').getTime()).toBeGreaterThan(farFuture);
    expect(new Date(DEMO_EVENT.uploadWindowEndsAt ?? '').getTime()).toBeGreaterThan(farFuture);
  });

  it('is paid, so nothing renders an awaiting-payment state', () => {
    expect(DEMO_EVENT.paid).toBe(true);
  });

  it('has the slideshow enabled, since the demo shows it', () => {
    expect(DEMO_EVENT.liveSlideshowEnabled).toBe(true);
  });

  it('uses an id that cannot collide with a real event', () => {
    // Real ids are UUIDs; this is deliberately not one.
    expect(DEMO_EVENT_ID).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(DEMO_EVENT.id).toBe(DEMO_EVENT_ID);
  });
});

describe('the slideshow timer', () => {
  it('wraps back to the first photo', () => {
    expect(nextSlide(0, 3)).toBe(1);
    expect(nextSlide(2, 3)).toBe(0);
  });

  it('visits every photo before repeating', () => {
    const seen = new Set<number>();
    let at = 0;
    for (let step = 0; step < DEMO_PHOTOS.length; step += 1) {
      seen.add(at);
      at = nextSlide(at, DEMO_PHOTOS.length);
    }
    expect(seen.size).toBe(DEMO_PHOTOS.length);
    expect(at).toBe(0);
  });

  it('survives an empty list rather than dividing by zero', () => {
    expect(nextSlide(0, 0)).toBe(0);
    expect(nextSlide(5, 0)).toBe(0);
  });

  it('holds each photo long enough to look at', () => {
    expect(DEMO_SLIDE_MS).toBeGreaterThanOrEqual(2000);
    expect(DEMO_SLIDE_MS).toBeLessThanOrEqual(8000);
  });
});
