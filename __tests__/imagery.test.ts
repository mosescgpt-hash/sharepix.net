import {
  IMAGE_SLOTS,
  PLACEHOLDER_TONES,
  artworkFor,
  missingPhotography,
  photographyCoverage,
  toneFor,
} from '../lib/imagery';

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
  // These two assertions are meant to FAIL once real assets land. That is the
  // signal to update them, and the audit's "there is no photography" finding
  // stops being true silently.
  it('reports every slot as outstanding while the registry is empty', () => {
    expect(missingPhotography()).toHaveLength(IMAGE_SLOTS.length);
    expect(photographyCoverage()).toBe(0);
  });

  it('reports a placeholder for a slot with no photo', () => {
    const art = artworkFor('home-hero');
    expect(art.kind).toBe('placeholder');
  });
});
