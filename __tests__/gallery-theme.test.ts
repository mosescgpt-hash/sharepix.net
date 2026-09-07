import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCENT_TEXT_CONTRAST,
  DEFAULT_FONT_SET,
  DEFAULT_GALLERY_LAYOUT,
  FONT_SETS,
  GALLERY_BACKGROUND,
  GALLERY_LAYOUTS,
  accentUse,
  contrastRatio,
  fontSetFor,
  isFontSetKey,
  isGalleryLayout,
  layoutFor,
  normalizeAccent,
  resolveGalleryTheme,
  themeStyle,
} from '../lib/galleryTheme';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const bodyOf = (source: string) => source.slice(source.indexOf('*/') + 2).trim();

describe('the copies have not drifted', () => {
  it('keeps update-event/galleryTheme.ts byte-identical with lib/', () => {
    expect(bodyOf(read('amplify/functions/update-event/galleryTheme.ts'))).toBe(
      bodyOf(read('lib/galleryTheme.ts')),
    );
  });
});

describe('what a host may choose', () => {
  it('accepts only the offered keys', () => {
    for (const set of FONT_SETS) expect(isFontSetKey(set.key)).toBe(true);
    for (const layout of GALLERY_LAYOUTS) expect(isGalleryLayout(layout.key)).toBe(true);
    // A key not on the list is not a custom theme, it is an unvalidated value
    // one render away from reaching another person's browser.
    expect(isFontSetKey('comic-sans')).toBe(false);
    expect(isFontSetKey('')).toBe(false);
    expect(isFontSetKey(null)).toBe(false);
    expect(isFontSetKey({ key: 'sharepix' })).toBe(false);
    expect(isGalleryLayout('freeform')).toBe(false);
  });

  it('falls back to the default rather than to nothing', () => {
    // An event with no theme, a stale value, or one created before this
    // existed must all render — not error, and not render half-styled.
    expect(fontSetFor(null).key).toBe(DEFAULT_FONT_SET);
    expect(fontSetFor('nonsense').key).toBe(DEFAULT_FONT_SET);
    expect(layoutFor(undefined)).toBe(DEFAULT_GALLERY_LAYOUT);
    expect(layoutFor('nonsense')).toBe(DEFAULT_GALLERY_LAYOUT);
  });

  it('ends every font stack in a real generic family', () => {
    // A stack that names only a webfont renders in whatever the browser
    // defaults to when the download fails — which, at a venue on bad signal,
    // is exactly when it will.
    for (const set of FONT_SETS) {
      expect(set.heading).toMatch(/(sans-serif|serif)$/);
      expect(set.body).toMatch(/(sans-serif|serif)$/);
    }
  });

  it('is built from few enough families to load on venue wifi', () => {
    // Every family is a download on a phone at the moment a guest is deciding
    // whether this is worth the bother. Four looks, three families.
    const families = new Set<string>();
    for (const set of FONT_SETS) {
      for (const stack of [set.heading, set.body]) {
        const first = stack.split(',')[0].replace(/"/g, '').trim();
        families.add(first);
      }
    }
    expect(families.size).toBeLessThanOrEqual(3);
  });

  it('actually loads every family it names', () => {
    // A set naming a family the page never requests falls back silently to
    // Georgia, and the host's chosen "Elegant" is just a serif.
    const css = read('styles/globals.css');
    for (const set of FONT_SETS) {
      for (const stack of [set.heading, set.body]) {
        const first = stack.split(',')[0].replace(/"/g, '').trim();
        expect(css).toContain(first.replace(/ /g, '+'));
      }
    }
  });
});

describe('the accent colour', () => {
  it('accepts hex in the shapes a person actually types', () => {
    expect(normalizeAccent('#7B2D3B')).toBe('#7b2d3b');
    expect(normalizeAccent('7b2d3b')).toBe('#7b2d3b');
    expect(normalizeAccent('#abc')).toBe('#aabbcc');
    expect(normalizeAccent('  #7B2D3B  ')).toBe('#7b2d3b');
  });

  it('refuses anything that is not a hex colour', () => {
    // This value is interpolated into a style attribute. The only safe answer
    // to "is this a colour?" is a shape we fully control — a CSS colour name,
    // a var() and an rgb() call are all refused for that reason.
    for (const bad of [
      'red',
      'var(--x)',
      'rgb(1,2,3)',
      'url(evil)',
      '#12345',
      '#gggggg',
      'expression(alert(1))',
      '',
      null,
      42,
    ]) {
      expect(normalizeAccent(bad)).toBeNull();
    }
  });

  it('says when a colour is too pale for text, without refusing it', () => {
    // A host's actual wedding colour might be a pale blush. Telling them their
    // colour is wrong helps nobody; using it for rules and keeping readable
    // ink for words is the honest answer.
    const pale = accentUse('#f5e6e8');
    expect(pale).not.toBeNull();
    expect(pale?.usableForText).toBe(false);

    const deep = accentUse('#7b2d3b');
    expect(deep?.usableForText).toBe(true);
    expect(deep!.contrast).toBeGreaterThanOrEqual(ACCENT_TEXT_CONTRAST);
  });

  it('measures contrast against the background the gallery actually has', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio(GALLERY_BACKGROUND, GALLERY_BACKGROUND)).toBeCloseTo(1, 5);
  });
});

describe('what reaches the page', () => {
  it('emits only custom properties, never markup', () => {
    const style = themeStyle(resolveGalleryTheme({ galleryAccent: '#7b2d3b' }));
    for (const key of Object.keys(style)) expect(key.startsWith('--spx-event-')).toBe(true);
    expect(style['--spx-event-accent']).toBe('#7b2d3b');
  });

  it('sets no accent variables at all when there is no accent', () => {
    // Absent rather than empty, so the CSS var() fallbacks resolve to the
    // brand and an unstyled event renders exactly as it always did.
    const style = themeStyle(resolveGalleryTheme({}));
    expect(style['--spx-event-accent']).toBeUndefined();
    expect(style['--spx-event-accent-text']).toBeUndefined();
  });

  it('withholds the accent from text when it cannot be read', () => {
    const style = themeStyle(resolveGalleryTheme({ galleryAccent: '#f5e6e8' }));
    expect(style['--spx-event-accent']).toBe('#f5e6e8');
    expect(style['--spx-event-accent-text']).toBe('inherit');
  });

  it('knows whether the host changed anything', () => {
    expect(resolveGalleryTheme({}).customized).toBe(false);
    expect(resolveGalleryTheme({ galleryLayout: 'mosaic' }).customized).toBe(true);
    expect(resolveGalleryTheme({ galleryAccent: '#7b2d3b' }).customized).toBe(true);
    // A value equal to the default is not a customisation.
    expect(resolveGalleryTheme({ galleryLayout: DEFAULT_GALLERY_LAYOUT }).customized).toBe(false);
  });
});

describe('the server is what enforces it', () => {
  const settings = read('amplify/functions/update-event/settings.ts');
  const grid = read('components/PhotoGrid.tsx');
  const gallery = read('pages/event/[eventId]/index.tsx');

  it('validates every field before storing it', () => {
    expect(settings).toContain('isFontSetKey(request.galleryFontSet)');
    expect(settings).toContain('isGalleryLayout(request.galleryLayout)');
    expect(settings).toContain('normalizeAccent(raw)');
  });

  it('refuses an unknown key rather than storing it', () => {
    // Storing an unvalidated value and ignoring it at render time leaves it one
    // careless read away from being trusted.
    expect(settings).toContain('Choose one of the available font styles.');
    expect(settings).toContain('Choose one of the available layouts.');
  });

  it('lets a host clear the accent', () => {
    expect(settings).toContain("remove.push('galleryAccent')");
  });

  it('treats the fields as independent', () => {
    // QR branding validates as one style because colour and logo travel
    // together. These do not: picking a layout says nothing about the fonts,
    // and resetting them would lose a choice the host already made.
    expect(settings).toContain('if (request.galleryFontSet !== undefined)');
    expect(settings).toContain('if (request.galleryLayout !== undefined)');
    expect(settings).toContain('if (request.galleryAccent !== undefined)');
  });

  it('renders an unknown layout as the ordinary grid', () => {
    expect(grid).toContain('layoutClassFor');
    expect(grid).toMatch(/return 'grid grid-cols-2/);
  });

  it('applies the theme as a style object, not as a class string', () => {
    expect(gallery).toContain('themeStyle(theme)');
    expect(gallery).toContain('spx-themed-event');
  });
});

describe('what the theme deliberately does not restyle', () => {
  it('scopes every rule to the event wrapper', () => {
    // A host is dressing their gallery, not restyling the product. A guest who
    // cannot find the upload button because of a font choice is a failure of
    // the thing SharePix is for.
    const css = read('styles/globals.css');
    const themed = css.slice(css.indexOf('.spx-themed-event'));
    for (const rule of themed.split('}')) {
      const selector = rule.split('{')[0].trim();
      if (!selector || selector.startsWith('/*') || selector.startsWith('*')) continue;
      for (const part of selector.split(',')) {
        const clean = part.trim();
        if (!clean || clean.startsWith('/*')) continue;
        expect(clean.startsWith('.spx-themed-event')).toBe(true);
      }
    }
  });
});
