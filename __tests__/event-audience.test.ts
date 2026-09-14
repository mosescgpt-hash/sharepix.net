import {
  AUDIENCE_HELP,
  AUDIENCE_OPTIONS,
  AUDIENCE_QUESTION,
  invitesUploads,
  parseAudience,
  qrCaption,
  reviewNote,
  signHeadline,
  signMessage,
} from '../lib/eventAudience';
import { DEFAULT_HEADLINE, DEFAULT_MESSAGE, tentContent } from '../lib/tableTent';
import { codeOnly, readSource } from './sourceGuards';

/**
 * Who the QR signs are addressed to.
 *
 * The church: one person shooting, one person uploading, parents opening the
 * gallery to look. Every card SharePix printed for them said "Scan to add your
 * photos", which is an instruction nobody in the room was meant to follow.
 */

describe('reading the answer', () => {
  it('accepts the two answers and nothing else', () => {
    expect(parseAudience('guests')).toBe('guests');
    expect(parseAudience('host-only')).toBe('host-only');
    for (const junk of ['', 'GUESTS', 'host only', 'yes', null, undefined, 0, {}]) {
      expect({ junk, parsed: parseAudience(junk) }).toEqual({ junk, parsed: null });
    }
  });

  it('treats an unanswered event as inviting uploads', () => {
    // Every event created before the question exists has no answer, and there
    // is no honest way to infer one. They keep the wording they were printed
    // with — a card already on a table says what it says.
    expect(invitesUploads(null)).toBe(true);
    expect(invitesUploads('guests')).toBe(true);
    expect(invitesUploads('host-only')).toBe(false);
  });
});

describe('what the signs say', () => {
  it('asks guests to add photos when guests are adding photos', () => {
    expect(signHeadline('guests')).toBe('Scan to add your photos');
    expect(signHeadline(null)).toBe('Scan to add your photos');
  });

  it('asks them to look when the host is the only one uploading', () => {
    expect(signHeadline('host-only')).toBe('Scan to see the photos');
    expect(signMessage('host-only')).not.toMatch(/upload/i);
  });

  it('still tells host-only guests they can save the photos', () => {
    // The one thing that would be a real loss: a guest concluding they cannot
    // take the pictures away. Downloads are included on every plan either way.
    expect(signMessage('host-only')).toMatch(/save/i);
  });

  it('never tells anyone they cannot upload', () => {
    // 'host-only' words a sign; it does not close uploads, and a sign that
    // claimed otherwise would be false.
    for (const audience of ['guests', 'host-only', null] as const) {
      expect(signMessage(audience)).not.toMatch(/can(not|'t)\s+upload/i);
    }
  });

  it('matches the caption on the dashboard to the printed card', () => {
    // A host reading the dashboard and a guest reading the table tent should
    // be told the same thing.
    expect(qrCaption('guests', 'A Wedding')).toMatch(/upload/i);
    expect(qrCaption('host-only', 'A Wedding')).toMatch(/see the photos/i);
    expect(qrCaption('host-only', 'A Wedding')).toContain('A Wedding');
  });
});

describe('the question itself', () => {
  it('offers exactly two answers', () => {
    expect(AUDIENCE_OPTIONS.map((o) => o.value)).toEqual(['guests', 'host-only']);
  });

  it('describes both, so neither reads as the bare alternative', () => {
    for (const option of AUDIENCE_OPTIONS) {
      expect({ value: option.value, hasDetail: option.detail.length > 10 }).toEqual({
        value: option.value,
        hasDetail: true,
      });
    }
  });

  it('does not imply one answer is the better event', () => {
    // "Just me" is a legitimate, fully-featured way to use SharePix. A question
    // phrased as a test of guest participation is one the church fails.
    const text = [AUDIENCE_QUESTION, AUDIENCE_HELP, ...AUDIENCE_OPTIONS.map((o) => o.detail)]
      .join(' ')
      .toLowerCase();
    // "only" is absent from the list on purpose: "Just me" and "the only one
    // adding photos" are the plain description, not a judgement.
    for (const word of ['limited', 'basic', 'recommended', 'instead', 'unfortunately']) {
      expect({ word, present: text.includes(word) }).toEqual({ word, present: false });
    }
  });

  it('says what turns on the answer', () => {
    // A host choosing between two options deserves to know what changes, and
    // "it only words the signs" is both true and reassuring.
    expect(AUDIENCE_HELP).toMatch(/wording|signs/i);
    expect(AUDIENCE_HELP).toMatch(/change it later/i);
  });
});

describe('the table tent follows it', () => {
  const event = { name: 'Sunday Service', eventCode: 'coffee-lamp-river' };

  it('prints the upload wording by default', () => {
    const content = tentContent(event, 'https://example.test/upload');
    expect(content.headline).toBe(DEFAULT_HEADLINE);
    expect(content.message).toBe(DEFAULT_MESSAGE);
  });

  it('prints the viewing wording for a host-only event', () => {
    const content = tentContent(
      { ...event, uploadAudience: 'host-only' },
      'https://example.test/upload',
    );
    expect(content.headline).toBe('Scan to see the photos');
    expect(content.message).not.toMatch(/upload the pictures/i);
  });

  it('lets a host’s own words win over both', () => {
    // The audience picks a default. A host who typed something keeps it.
    const content = tentContent(
      { ...event, uploadAudience: 'host-only' },
      'https://example.test/upload',
      { headline: 'Photos from today' },
    );
    expect(content.headline).toBe('Photos from today');
  });
});

describe('the refund review can tell the two apart', () => {
  it('says a host-only event planned to have one uploader', () => {
    expect(reviewNote('host-only')).toMatch(/only one adding photos/i);
  });

  it('says a guest event did not', () => {
    expect(reviewNote('guests')).toMatch(/guests would be adding/i);
  });

  it('does not invent an answer for an event created before the question', () => {
    expect(reviewNote(null)).toMatch(/before we asked/i);
  });

  it('reports what the host said, not what happened', () => {
    // This is a claim made at setup, not something SharePix observed, and the
    // person reading the dossier has to be able to tell.
    for (const audience of ['guests', 'host-only'] as const) {
      expect(reviewNote(audience)).toMatch(/the host said/i);
    }
  });
});

describe('no surface writes its own sign copy', () => {
  // The same failure as the sample-image notice: three near-copies of one
  // sentence, two updated and one missed. These are printed and handed to
  // guests, so a stale one is worse.
  const SURFACES = [
    'lib/tableTent.ts',
    'pages/event/[eventId]/brochure.tsx',
    'components/EventQRCode.tsx',
  ];

  it.each(SURFACES)('%s builds it from lib/eventAudience', (file) => {
    // lib/ imports relatively, pages and components through the alias.
    expect(readSource(file)).toMatch(/from '(\.|@\/lib)\/eventAudience'/);
  });

  it.each(SURFACES)('%s does not spell the headline out', (file) => {
    // Comments are stripped: these files explain what the wording used to be.
    const code = codeOnly(readSource(file));
    expect(code).not.toContain('Scan to add your photos');
    expect(code).not.toContain('Scan to see the photos');
  });
});
