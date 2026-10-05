import { USE_CASES, type UseCaseImage } from '../lib/useCases';
import { artworkFor } from '../lib/imagery';
import { GALLERY_SETS } from '../lib/siteImages.generated';

/**
 * Every picture on a use-case page is a real photo. An empty slot renders a
 * gradient tile, and a page of gradient tiles reads as unfinished — which is
 * what /weddings looked like with three captions over blank squares.
 */
const SAMPLE_PHOTOS = new Set(
  Object.values(GALLERY_SETS).flatMap((set) => set.map((file) => file.src)),
);

function describeImage(image: UseCaseImage) {
  if ('slot' in image) return { image: image.slot, real: artworkFor(image.slot).kind === 'photo' };
  return { image: image.photo, real: SAMPLE_PHOTOS.has(image.photo) && image.alt.length > 10 };
}

describe.each(USE_CASES.map((u) => [u.slug, u]))('/%s', (_slug, useCase) => {
  it('has a real photo beside the headline', () => {
    const d = describeImage(useCase.hero);
    expect(d).toEqual({ ...d, real: true });
  });

  it('has a real photo in every gallery tile', () => {
    for (const item of useCase.gallery) {
      const d = describeImage(item);
      expect(d).toEqual({ ...d, real: true });
    }
  });

  it('shows two or three tiles, and no photo twice', () => {
    expect(useCase.gallery.length).toBeGreaterThanOrEqual(2);
    expect(useCase.gallery.length).toBeLessThanOrEqual(3);
    const keys = [useCase.hero, ...useCase.gallery].map((i) => ('slot' in i ? i.slot : i.photo));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
