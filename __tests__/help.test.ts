import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  articlesInCategory,
  findArticle,
  searchHelp,
} from '../lib/help';

describe('help article structure', () => {
  it('has unique slugs', () => {
    const slugs = HELP_ARTICLES.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses URL-safe slugs', () => {
    for (const article of HELP_ARTICLES) {
      expect(article.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('gives every article a summary, keywords and a body', () => {
    for (const article of HELP_ARTICLES) {
      expect(article.summary.length).toBeGreaterThan(0);
      expect(article.keywords.length).toBeGreaterThan(0);
      expect(article.blocks.length).toBeGreaterThan(0);
    }
  });

  it('files every article under a real category', () => {
    // An article in a category the index does not render is invisible.
    for (const article of HELP_ARTICLES) {
      expect(HELP_CATEGORIES).toContain(article.category as (typeof HELP_CATEGORIES)[number]);
    }
  });

  it('leaves no category empty', () => {
    for (const category of HELP_CATEGORIES) {
      expect(articlesInCategory(category).length).toBeGreaterThan(0);
    }
  });

  it('has no dead related-article links', () => {
    for (const article of HELP_ARTICLES) {
      for (const slug of article.related ?? []) {
        expect(findArticle(slug)).toBeDefined();
      }
    }
  });

  it('never links an article to itself', () => {
    for (const article of HELP_ARTICLES) {
      expect(article.related ?? []).not.toContain(article.slug);
    }
  });

  it('covers both audiences', () => {
    const audiences = new Set(HELP_ARTICLES.map((article) => article.audience));
    expect(audiences).toEqual(new Set(['guest', 'host']));
  });
});

describe('help search', () => {
  it('finds an article by a word a reader would actually type', () => {
    // None of these words are in the titles they need to match.
    const cases: [string, string][] = [
      ['gps', 'photo-location-data'],
      ['projector', 'live-slideshow'],
      ['coupon', 'discount-codes'],
      ['2fa', 'mfa-setup'],
      ['zip', 'host-download-all'],
      ['locked out', 'reset-password'],
    ];
    for (const [query, slug] of cases) {
      expect(searchHelp(query).map((a) => a.slug)).toContain(slug);
    }
  });

  it('narrows as more words are typed rather than widening', () => {
    const broad = searchHelp('video');
    const narrow = searchHelp('video size');
    expect(broad.length).toBeGreaterThan(narrow.length);
    expect(narrow.length).toBeGreaterThan(0);
  });

  it('ignores case and returns nothing for an empty query', () => {
    expect(searchHelp('QR CODE').length).toBeGreaterThan(0);
    expect(searchHelp('   ')).toEqual([]);
  });
});

describe('help content stays true to the product', () => {
  // These are the numbers support answers with. If a limit changes and the
  // articles do not, the help centre starts lying to customers.
  it('quotes the current video ceiling', () => {
    const article = findArticle('video-wont-upload')!;
    const text = article.blocks.map((b) => ('text' in b ? b.text : b.steps.join(' '))).join(' ');
    expect(text).toContain('500 MB');
  });

  it('quotes the current per-plan video allowances', () => {
    const article = findArticle('video-limits')!;
    expect(article.summary).toContain('Two');
    expect(article.summary).toContain('ten');
    expect(article.summary).toContain('thirty');
  });
});
