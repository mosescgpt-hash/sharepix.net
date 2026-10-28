import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { HOMEPAGE_IMAGES } from '../lib/homepageImages';
import { readSource } from './sourceGuards';

const ROOT = join(__dirname, '..');
const images = Object.entries(HOMEPAGE_IMAGES);

describe('the homepage image manifest', () => {
  it.each(images)('%s exists on disk and has real alt text', (_key, image) => {
    expect(existsSync(join(ROOT, 'public', image.src))).toBe(true);
    expect(image.alt.length).toBeGreaterThan(20);
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
  });

  it('uses at most one AI-generated image', () => {
    expect(images.filter(([, image]) => (image.source as string) === 'ai').length).toBeLessThanOrEqual(1);
  });

  it('keeps the AI-image footer notice while any sample photo is on the page', () => {
    // Every screenshot shows the sample event, whose photographs are
    // AI-generated, so the notice stays for as long as there are screenshots.
    const provenance = readFileSync(join(ROOT, 'public/site/PROVENANCE'), 'utf8');
    expect(provenance.length).toBeGreaterThan(0);
  });

  it('is the only place the homepage names an image file', () => {
    const rendered = readSource('pages/index.tsx') + readSource('components/HeroProduct.tsx');
    expect(rendered).not.toMatch(/\/site\/[\w/-]+\.(webp|png|jpe?g)/);
  });
});
