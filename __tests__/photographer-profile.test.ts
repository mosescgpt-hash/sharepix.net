import {
  EMPTY_PROFILE,
  PREVIEW_SIZE_OPTIONS,
  normalizeLink,
  prepareProfile,
} from '../lib/photographerProfile';
import { MAX_PREVIEW_LONG_EDGE, MIN_PREVIEW_LONG_EDGE } from '../lib/professionalMedia';
import { readSource } from './sourceGuards';

describe('photographer profile', () => {
  it('turns a bare domain into an https link and refuses anything unsafe', () => {
    expect(normalizeLink('')).toBe('');
    expect(normalizeLink('  riverastudio.com ')).toBe('https://riverastudio.com');
    expect(normalizeLink('http://example.com/shop')).toBe('http://example.com/shop');
    expect(normalizeLink('javascript:alert(1)')).toBeNull();
    expect(normalizeLink('mailto:me@example.com')).toBeNull();
    expect(normalizeLink('not a link')).toBeNull();
  });

  it('cleans up a good form for saving', () => {
    const result = prepareProfile({
      ...EMPTY_PROFILE,
      businessName: '  Rivera Photography ',
      website: 'rivera.example',
      previewLongEdge: 99999,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.businessName).toBe('Rivera Photography');
    expect(result.value.website).toBe('https://rivera.example');
    expect(result.value.previewLongEdge).toBe(MAX_PREVIEW_LONG_EDGE);
  });

  it('names the field that stops a save', () => {
    const result = prepareProfile({ ...EMPTY_PROFILE, purchaseGalleryUrl: 'ftp://x.example' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.problems)).toEqual(['purchaseGalleryUrl']);
  });

  it('offers only preview sizes the processor accepts', () => {
    for (const size of PREVIEW_SIZE_OPTIONS) {
      expect(size).toBeGreaterThanOrEqual(MIN_PREVIEW_LONG_EDGE);
      expect(size).toBeLessThanOrEqual(MAX_PREVIEW_LONG_EDGE);
    }
  });

  it('saves every field the photo processor reads', () => {
    const api = readSource('lib/api.ts');
    const save = api.slice(api.indexOf('export async function saveMyPhotographerProfile'));
    const processor = readSource('amplify/functions/process-pro-photo/handler.ts');
    for (const field of [
      'businessName',
      'website',
      'contactUrl',
      'purchaseGalleryUrl',
      'defaultPreviewResolution',
      'keepOriginals',
    ]) {
      expect(processor).toContain(field);
      expect(save).toContain(`${field}:`);
    }
  });

  it('is linked from the photographer pages', () => {
    expect(readSource('pages/pro/index.tsx')).toContain('href="/pro/profile"');
    expect(readSource('pages/pro/events/[eventId]/review.tsx')).toContain('href="/pro/profile"');
  });
});
