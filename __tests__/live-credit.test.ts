import { codeOnly, readSource } from './sourceGuards';

describe('the photographer credit is live', () => {
  it('reads the name and links from the profile on every gallery load', () => {
    const list = codeOnly(readSource('amplify/functions/list-event-photos/handler.ts'));
    expect(list).toContain('BatchGetItemCommand');
    expect(list).toContain(
      'photographerName: professional ? (live ? live.name : item.photographerName?.S ?? null) : null',
    );
    const schema = readSource('amplify/data/resource.ts');
    const eventPhoto = schema.slice(schema.indexOf('EventPhoto: a.customType'), schema.indexOf('listEventPhotos: a'));
    for (const field of ['sourceType', 'photographerName', 'photographerWebsite', 'purchaseUrl', 'contactUrl']) {
      expect(eventPhoto).toContain(`${field}: a.string()`);
    }
  });
});

describe('SharePix never watermarks photos', () => {
  it('stamps nothing onto a professional preview', () => {
    const processor = codeOnly(readSource('amplify/functions/process-pro-photo/handler.ts'));
    expect(processor).not.toMatch(/applyWatermark|watermarkSpec|image\.print/);
    expect(processor).toContain('watermarkEnabled: { BOOL: false }');
  });

  it('offers no watermark setting to photographers', () => {
    const page = codeOnly(readSource('pages/pro/profile.tsx'));
    expect(page).not.toMatch(/watermark/i);
    const api = codeOnly(readSource('lib/api.ts'));
    expect(api).toContain('watermarkEnabled: false,');
    expect(api).not.toContain('refreshProWatermarks');
  });

  it('does not promise one in the photographer pages', () => {
    for (const path of ['pages/pro/index.tsx', 'pages/pro/events/[eventId]/review.tsx']) {
      expect(readSource(path)).not.toMatch(/watermark/i);
    }
  });
});
