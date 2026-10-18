import {
  DEFAULT_WATERMARK_OPACITY,
  clampOpacity,
  cleanPreviewKey,
  isLogoDataUrl,
  placement,
  watermarkSpec,
} from '../lib/watermark';
import { EMPTY_PROFILE, prepareProfile, watermarkChanged } from '../lib/photographerProfile';
import { codeOnly, readSource } from './sourceGuards';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

describe('what gets stamped', () => {
  it('stamps nothing unless switched on', () => {
    expect(watermarkSpec({ watermarkEnabled: false, watermarkText: 'x' })).toBeNull();
  });

  it('falls back to the business name for text', () => {
    expect(watermarkSpec({ watermarkEnabled: true, businessName: 'Rivera' })?.text).toBe('Rivera');
  });

  it('uses the logo only when the style asks for it, and only a real image', () => {
    expect(watermarkSpec({ watermarkEnabled: true, watermarkStyle: 'text', watermarkText: 'a', watermarkLogo: LOGO })?.logo).toBeNull();
    expect(watermarkSpec({ watermarkEnabled: true, watermarkStyle: 'logo', watermarkLogo: LOGO })).toMatchObject({ text: null, logo: LOGO });
    expect(watermarkSpec({ watermarkEnabled: true, watermarkStyle: 'logo', watermarkLogo: 'javascript:x' })).toBeNull();
    expect(isLogoDataUrl('data:image/svg+xml;base64,AAAA')).toBe(false);
  });

  it('clamps opacity and defaults the position', () => {
    expect(clampOpacity(5)).toBe(10);
    expect(clampOpacity(500)).toBe(100);
    expect(clampOpacity(null)).toBe(DEFAULT_WATERMARK_OPACITY);
    expect(watermarkSpec({ watermarkEnabled: true, watermarkText: 'a', watermarkPosition: 'nowhere' })?.position).toBe('bottom-left');
  });

  it('places the mark inside the image in every position', () => {
    for (const position of ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'center'] as const) {
      const { x, y } = placement(1800, 1200, 400, 120, position);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + 400).toBeLessThanOrEqual(1800);
      expect(y + 120).toBeLessThanOrEqual(1200);
    }
    expect(placement(1800, 1200, 400, 120, 'bottom-right')).toEqual({ x: 1800 - 400 - 36, y: 1200 - 120 - 36 });
  });

  it('keeps the clean copy beside the preview', () => {
    expect(cleanPreviewKey('pro/e1/previews/u1')).toBe('pro/e1/clean/u1');
    expect(cleanPreviewKey('events/e1/photos/x.jpg')).toBeNull();
  });
});

describe('the profile form', () => {
  it('needs a logo for a logo-only watermark', () => {
    const result = prepareProfile({ ...EMPTY_PROFILE, watermarkEnabled: true, watermarkStyle: 'logo' });
    expect(result.ok).toBe(false);
  });

  it('redoes posted photos only when the watermark changed', () => {
    const base = { ...EMPTY_PROFILE, watermarkEnabled: true, watermarkText: 'a' };
    expect(watermarkChanged({ ...base, website: 'https://x.example' }, base)).toBe(false);
    expect(watermarkChanged({ ...base, watermarkOpacity: 40 }, base)).toBe(true);
    expect(watermarkChanged({ ...base, watermarkPosition: 'center' }, base)).toBe(true);
  });
});

describe('it is live', () => {
  it('reads the name and links from the profile on every gallery load', () => {
    const list = codeOnly(readSource('amplify/functions/list-event-photos/handler.ts'));
    expect(list).toContain('BatchGetItemCommand');
    expect(list).toContain("photographerName: professional ? (live ? live.name : item.photographerName?.S ?? null) : null");
    const schema = readSource('amplify/data/resource.ts');
    const eventPhoto = schema.slice(schema.indexOf('EventPhoto: a.customType'), schema.indexOf('listEventPhotos: a'));
    for (const field of ['sourceType', 'photographerName', 'photographerWebsite', 'purchaseUrl', 'contactUrl']) {
      expect(eventPhoto).toContain(`${field}: a.string()`);
    }
  });

  it('keeps a clean copy of every new preview, before stamping', () => {
    const processor = codeOnly(readSource('amplify/functions/process-pro-photo/handler.ts'));
    expect(processor.indexOf('Key: cleanKey')).toBeGreaterThan(-1);
    expect(processor.indexOf('Key: cleanKey')).toBeLessThan(processor.indexOf('await applyWatermark(image, watermark)'));
  });

  it('re-stamps from the clean copy, for the caller only', () => {
    const worker = codeOnly(readSource('amplify/functions/restamp-pro-photos/handler.ts'));
    expect(worker).toContain('const source = await bytes(clean);');
    expect(worker).toContain("ConditionExpression: 'photographerId = :p'");
    const request = codeOnly(readSource('amplify/functions/refresh-pro-watermarks/handler.ts'));
    expect(request).toContain('JSON.stringify({ photographerId: sub })');
    const backend = codeOnly(readSource('amplify/backend.ts'));
    expect(backend).toContain('restampFn.grantInvoke(refreshWatermarksFn)');
  });

  it('asks for the re-stamp after a save that changed the watermark', () => {
    const page = codeOnly(readSource('pages/pro/profile.tsx'));
    expect(page).toContain('const redo = watermarkChanged(prepared.value, saved);');
    expect(page).toContain('await refreshProWatermarks()');
  });
});
