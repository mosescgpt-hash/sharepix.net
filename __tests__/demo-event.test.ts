import {
  DEMO_EVENT,
  DEMO_EVENT_ID,
  DEMO_GALLERIES,
  DEMO_GALLERY_KEYS,
  DEMO_GUEST_BOOK,
  DEMO_PHOTOS,
  DEMO_SLIDE_MS,
  demoGallery,
  demoImage,
  isDemoGalleryKey,
  nextSlide,
} from '../lib/demoEvent';

const EVERY_GALLERY = DEMO_GALLERIES.map((gallery) => [gallery.key, gallery] as const);

describe.each(EVERY_GALLERY)('the %s sample gallery', (_key, gallery) => {
  it('produces a full grid', () => {
    expect(gallery.photos.length).toBeGreaterThanOrEqual(8);
    expect(gallery.event.photoCount).toBe(gallery.photos.length);
  });

  it('gives every photo an image that needs no third party', () => {
    // Either an inline SVG or a file this repository serves itself. Never a
    // stock CDN: the demo has to render with no network beyond our own origin,
    // and no licence to keep track of.
    for (const photo of gallery.photos) {
      const inline = photo.url.startsWith('data:image/svg+xml,');
      const ours = photo.url.startsWith(`/site/gallery/${gallery.key}/`);
      expect(inline || ours).toBe(true);
      if (inline) expect(photo.url.length).toBeGreaterThan(100);
    }
  });

  it('takes all its tiles from one source, never a mix', () => {
    // Half photographs and half gradient placeholders in one grid reads as a
    // gallery that failed to load, not as a sample.
    const kinds = new Set(
      gallery.photos.map((photo) => (photo.url.startsWith('data:') ? 'svg' : 'file')),
    );
    expect(kinds.size).toBe(1);
  });

  it('says which kind it is showing, so the page can say so too', () => {
    expect(gallery.isPhotography).toBe(!gallery.photos[0].url.startsWith('data:'));
  });

  it('describes every photo, whichever source it came from', () => {
    // The grid has no visible captions, so for a photograph this text is the
    // only description a screen reader gets.
    for (const photo of gallery.photos) {
      expect((gallery.captions[photo.id] ?? '').length).toBeGreaterThan(2);
    }
  });

  it('has no fallback url, because there is no second copy', () => {
    for (const photo of gallery.photos) expect(photo.fallbackUrl).toBeUndefined();
  });

  it('gives every photo a unique id, as the grid keys on it', () => {
    expect(new Set(gallery.photos.map((photo) => photo.id)).size).toBe(gallery.photos.length);
  });

  it('shapes keys like real ones, so key parsers behave normally', () => {
    for (const photo of gallery.photos) {
      expect(photo.s3Key.startsWith(`events/${gallery.event.id}/photos/`)).toBe(true);
      expect(photo.eventId).toBe(gallery.event.id);
    }
  });

  it('spreads the photos over time, so sorting by time does something', () => {
    const times = gallery.photos.map((photo) => new Date(photo.createdAt ?? '').getTime());
    expect(new Set(times).size).toBe(times.length);
    for (const time of times) expect(Number.isFinite(time)).toBe(true);
  });

  it('credits several different guests, with some uploading more than once', () => {
    // A gallery where every photo says the same name doesn't show the point —
    // and one where every photo has a DIFFERENT name makes sorting by uploader
    // look useless. Real events sit in between.
    const names = gallery.photos.map((photo) => photo.uploadedBy);
    const unique = new Set(names);
    expect(unique.size).toBeGreaterThan(3);
    expect(unique.size).toBeLessThan(names.length);
    expect(gallery.contributors).toBe(unique.size);
  });

  it('shows every photo as approved, so none is hidden as under review', () => {
    for (const photo of gallery.photos) expect(photo.approved).toBe(true);
  });

  it('varies between tiles', () => {
    const urls = new Set(gallery.photos.map((photo) => photo.url));
    expect(urls.size).toBe(gallery.photos.length);
  });

  it('never looks expired, however long the page is up', () => {
    // A demo that starts showing "this gallery has closed" is worse than none.
    const farFuture = new Date('2090-01-01').getTime();
    expect(new Date(gallery.event.accessExpiresAt ?? '').getTime()).toBeGreaterThan(farFuture);
    expect(new Date(gallery.event.uploadWindowEndsAt ?? '').getTime()).toBeGreaterThan(farFuture);
  });

  it('is paid, with the slideshow on, so no page renders a half-set-up event', () => {
    expect(gallery.event.paid).toBe(true);
    expect(gallery.event.liveSlideshowEnabled).toBe(true);
  });

  it('uses an id that cannot collide with a real event', () => {
    // Real ids are UUIDs; these are deliberately not.
    expect(gallery.event.id).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('says what it is, in words that fit the switcher', () => {
    expect(gallery.label.length).toBeGreaterThan(3);
    expect(gallery.label.length).toBeLessThan(24);
    expect(gallery.blurb.length).toBeGreaterThan(20);
  });
});

describe('the three galleries together', () => {
  it('covers every declared key exactly once', () => {
    expect(DEMO_GALLERIES.map((gallery) => gallery.key)).toEqual([...DEMO_GALLERY_KEYS]);
  });

  it('shares no event id', () => {
    const ids = DEMO_GALLERIES.map((gallery) => gallery.event.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shares no photo id, so switching cannot show a stale selection', () => {
    const ids = DEMO_GALLERIES.flatMap((gallery) => gallery.photos.map((photo) => photo.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shares no guest name between occasions', () => {
    // Two sample galleries crediting the same "Aunt Bea" would read as one
    // family attending a trade show.
    for (const [i, left] of DEMO_GALLERIES.entries()) {
      for (const right of DEMO_GALLERIES.slice(i + 1)) {
        const names = new Set(right.photos.map((photo) => photo.uploadedBy));
        for (const photo of left.photos) expect(names.has(photo.uploadedBy)).toBe(false);
      }
    }
  });

  it('shares no image, so each occasion looks like itself', () => {
    const urls = DEMO_GALLERIES.flatMap((gallery) => gallery.photos.map((photo) => photo.url));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('puts the wedding first, since that is what an unqualified link shows', () => {
    expect(DEMO_GALLERIES[0].key).toBe('wedding');
    expect(DEMO_PHOTOS).toBe(DEMO_GALLERIES[0].photos);
    expect(DEMO_EVENT).toBe(DEMO_GALLERIES[0].event);
    expect(DEMO_EVENT.id).toBe(DEMO_EVENT_ID);
  });
});

describe('choosing a gallery from a query parameter', () => {
  it('resolves each key', () => {
    for (const gallery of DEMO_GALLERIES) {
      expect(demoGallery(gallery.key)).toBe(gallery);
    }
  });

  it('falls back to the wedding for anything else, rather than crashing', () => {
    // The argument is a URL query parameter, so it can be absent, repeated
    // (which Next hands over as an array), or hostile.
    for (const bad of [undefined, null, '', 'Wedding', 'holiday ', ['wedding'], 7, {}]) {
      expect(demoGallery(bad)).toBe(DEMO_GALLERIES[0]);
    }
  });

  it('recognises exactly the declared keys', () => {
    for (const key of DEMO_GALLERY_KEYS) expect(isDemoGalleryKey(key)).toBe(true);
    for (const bad of ['weddings', '', 'holiday ', 42, null]) {
      expect(isDemoGalleryKey(bad)).toBe(false);
    }
  });
});

describe('the guest book', () => {
  it('leaves no note pointing at a photo that is not there', () => {
    // The notes are written against the wedding's first few ids; emptying that
    // gallery folder shortens the array and must not strand one.
    const ids = new Set(DEMO_PHOTOS.map((photo) => photo.id));
    for (const note of DEMO_GUEST_BOOK) {
      if (note.photoId) expect(ids.has(note.photoId)).toBe(true);
    }
  });

  it('belongs to the wedding, which is the event the demo pages walk through', () => {
    for (const note of DEMO_GUEST_BOOK) expect(note.eventId).toBe(DEMO_EVENT_ID);
  });
});

describe('the generated imagery', () => {
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
