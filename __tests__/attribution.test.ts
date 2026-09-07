import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SOURCE,
  EVENT_SOURCES,
  countBySource,
  isKnownSource,
  normalizeSource,
  sourceLabel,
} from '../lib/attribution';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const bodyOf = (source: string) => source.slice(source.indexOf('*/') + 2).trim();

describe('the two copies have not drifted', () => {
  it('keeps the Lambda copy byte-identical', () => {
    // The Lambda's copy is the one that decides what gets stored; the app's
    // copy only decides what a link says.
    expect(bodyOf(read('amplify/functions/create-event/attribution.ts'))).toBe(
      bodyOf(read('lib/attribution.ts')),
    );
  });
});

describe('a source is a closed set, not free text', () => {
  it('accepts only what the product recognises', () => {
    for (const source of EVENT_SOURCES) {
      expect(normalizeSource(source)).toBe(source);
      expect(isKnownSource(source)).toBe(true);
    }
  });

  it('quietly becomes direct for anything else', () => {
    // A source arrives as a URL parameter, which means it arrives from anyone.
    // Storing what was sent would be a stored-content hole and a data-quality
    // one at once — free text in the admin dashboard and a thousand spellings
    // of the same campaign.
    for (const claimed of [
      'facebook',
      'GUEST_UPLOAD; DROP TABLE',
      '<script>alert(1)</script>',
      'x'.repeat(500),
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(normalizeSource(claimed)).toBe('direct');
    }
  });

  it('is case and whitespace insensitive, since links get mangled', () => {
    expect(normalizeSource('  Guest_Upload ')).toBe('guest_upload');
    expect(normalizeSource('GUEST_UPLOAD')).toBe('guest_upload');
  });

  it('never refuses, because attribution is not worth blocking a sale over', () => {
    // An unrecognised source is a mis-typed link or someone poking at a query
    // string. Losing the attribution is the correct cost; refusing to create
    // the event is not.
    expect(() => normalizeSource('nonsense')).not.toThrow();
    expect(DEFAULT_SOURCE).toBe('direct');
  });

  it('has the guest-to-customer loop in it, which is the point', () => {
    expect(EVENT_SOURCES).toContain('guest_upload');
  });
});

describe('reading sources back', () => {
  it('labels every source in words', () => {
    for (const source of EVENT_SOURCES) {
      expect(sourceLabel(source)).toBeTruthy();
      expect(sourceLabel(source)).not.toBe(source);
    }
  });

  it('labels an unknown or missing value as direct rather than blank', () => {
    expect(sourceLabel(null)).toBe(sourceLabel('direct'));
    expect(sourceLabel('made up')).toBe(sourceLabel('direct'));
  });

  it('counts events by source, with older rows as direct', () => {
    const counts = countBySource([
      { source: 'guest_upload' },
      { source: 'guest_upload' },
      { source: 'print' },
      { source: null },
      {},
      { source: 'nonsense' },
    ]);
    expect(counts.guest_upload).toBe(2);
    expect(counts.print).toBe(1);
    // Missing, null and unrecognised all land in direct.
    expect(counts.direct).toBe(3);
    expect(counts.gallery).toBe(0);
  });

  it('returns a bucket for every source, so a chart has no holes', () => {
    const counts = countBySource([]);
    for (const source of EVENT_SOURCES) {
      expect(counts[source]).toBe(0);
    }
  });
});

describe('the guest-to-customer loop', () => {
  const form = read('components/UploadForm.tsx');

  it('appears only after an upload has actually succeeded', () => {
    // Showing it before, or during, would be selling into a moment the guest
    // is still trying to finish.
    const cta = form.slice(form.indexOf('Planning an event of your own?'));
    const guard = form.slice(0, form.indexOf('Planning an event of your own?'));
    expect(guard).toContain('{successCount > 0 && !busy ? (');
    expect(cta).toContain('/create-event?source=guest_upload');
  });

  it('is a link, not a button competing with the success message', () => {
    // The brief: "this should remain visually secondary" and "do not interrupt
    // upload success".
    const cta = form.slice(
      form.indexOf('Planning an event of your own?') - 400,
      form.indexOf('Planning an event of your own?') + 400,
    );
    expect(cta).not.toContain('spx-btn-ink');
    expect(cta).toContain('text-sm');
  });

  it('asks nothing of the guest', () => {
    // No account, no email, no form. They came to give someone else photos.
    const cta = form.slice(
      form.indexOf('Planning an event of your own?'),
      form.indexOf('Planning an event of your own?') + 500,
    );
    expect(cta).not.toMatch(/sign ?up|sign ?in|email|account/i);
  });
});

describe('the source is stamped server-side', () => {
  const handler = read('amplify/functions/create-event/handler.ts');

  it('normalises the claim rather than storing what was sent', () => {
    expect(handler).toContain('source: { S: normalizeSource(event.arguments.source) }');
  });

  it('never writes the raw argument', () => {
    const row = handler.slice(handler.indexOf('const item: Record<string, AttributeValue>'));
    const block = row.slice(0, row.indexOf('await putEvent'));
    expect(block).not.toMatch(/source: \{ S: event\.arguments\.source/);
  });
});
