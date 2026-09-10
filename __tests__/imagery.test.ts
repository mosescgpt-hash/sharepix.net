import {
  IMAGE_SLOTS,
  PLACEHOLDER_TONES,
  artworkFor,
  missingPhotography,
  photographyCoverage,
  toneFor,
} from '../lib/imagery';
import { SLOT_FILES } from '../lib/siteImages.generated';

describe('image slots', () => {
  it('has no duplicate slot names', () => {
    expect(new Set(IMAGE_SLOTS).size).toBe(IMAGE_SLOTS.length);
  });

  it('gives every slot artwork, never undefined', () => {
    for (const slot of IMAGE_SLOTS) {
      expect(artworkFor(slot)).toBeTruthy();
    }
  });

  // Alt text is the reason SLOT_META exists separately from the registry. A
  // slot that renders a placeholder still has to be describable to a screen
  // reader, and swapping in a photo later must not drop that work.
  it('gives every slot non-empty alt text', () => {
    for (const slot of IMAGE_SLOTS) {
      const art = artworkFor(slot);
      expect(art.alt.length).toBeGreaterThan(10);
    }
  });

  it('gives every slot real dimensions, so layout does not shift when photos land', () => {
    for (const slot of IMAGE_SLOTS) {
      const art = artworkFor(slot);
      expect(art.width).toBeGreaterThan(0);
      expect(art.height).toBeGreaterThan(0);
    }
  });
});

describe('placeholder tones', () => {
  it('stays inside the tone table', () => {
    for (const slot of IMAGE_SLOTS) {
      const tone = toneFor(slot);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(PLACEHOLDER_TONES.length);
    }
  });

  // The whole point of hashing the name rather than using an array index:
  // a slot keeps its tint across renders, reorders and deploys.
  it('is stable for the same slot', () => {
    expect(toneFor('occasion-wedding')).toBe(toneFor('occasion-wedding'));
  });

  it('does not give every slot the same tone', () => {
    const tones = new Set(IMAGE_SLOTS.map((slot) => toneFor(slot)));
    expect(tones.size).toBeGreaterThan(1);
  });
});

describe('photography coverage', () => {
  // Asserted as properties of whatever is in public/site/slots rather than
  // against a fixed list. The previous version of this block pinned "no
  // photography anywhere" and was written to fail the day that stopped being
  // true; it did. A count pinned here would fail again on the next photo, which
  // is a test that only ever reports that somebody did the thing they meant to.

  it('shows a photo for exactly the slots the folder has a file for', () => {
    for (const slot of IMAGE_SLOTS) {
      const art = artworkFor(slot);
      expect(art.kind).toBe(SLOT_FILES[slot] ? 'photo' : 'placeholder');
    }
  });

  it('serves those photos from the drop-in folder', () => {
    for (const slot of IMAGE_SLOTS) {
      const art = artworkFor(slot);
      if (art.kind !== 'photo') continue;
      expect(art.src).toBe(SLOT_FILES[slot]);
      expect(art.src.startsWith('/site/slots/')).toBe(true);
    }
  });

  it('names only slots that exist', () => {
    // A file named after a slot that has since been deleted must not become a
    // registry entry no page can ever ask for.
    for (const slot of Object.keys(SLOT_FILES)) {
      expect(IMAGE_SLOTS).toContain(slot);
    }
  });

  it('counts what is outstanding, and agrees with itself', () => {
    const outstanding = missingPhotography();
    for (const slot of outstanding) expect(SLOT_FILES[slot]).toBeUndefined();
    expect(photographyCoverage()).toBeCloseTo(
      (IMAGE_SLOTS.length - outstanding.length) / IMAGE_SLOTS.length,
    );
  });

  it('keeps the dimensions of the slot, not of the file', () => {
    // The layout contract belongs to the position on the page. A photo swapped
    // in at a different aspect ratio is cropped by object-cover; it must not
    // move the frame.
    const hero = artworkFor('home-hero');
    expect(hero.width).toBe(1600);
    expect(hero.height).toBe(1200);
  });
});
