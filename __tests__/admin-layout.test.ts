import { codeOnly, readSource } from './sourceGuards';

/**
 * The order of the event dashboard, asserted against the source.
 *
 * The page is one 1,300-line component behind `withAuthenticator`, so rendering
 * it in a test would mean standing up Cognito and a dozen API calls to check
 * something that is really a question about the file: is the QR code before the
 * font picker, and is Delete event still somewhere a host can hit it while
 * editing the event name?
 *
 * So this reads positions in the source. That is a blunt instrument and it is
 * worth being honest about what it can and cannot catch: it will not notice CSS
 * that moves a card visually, and it will not notice a card rendered inside a
 * condition that is never true. What it does catch is the thing that actually
 * went wrong — sections drifting back into the order they were built in, one
 * commit at a time, because nothing said otherwise.
 *
 * Comments are stripped first. Several of them name the old order on purpose
 * ("it used to render below the gallery-style card"), and a guard that reads
 * prose would be asserting against the explanation rather than the code. That
 * mistake has been made five times in this repository; `codeOnly` exists
 * because of it.
 */

const SOURCE = codeOnly(readSource('pages/event/[eventId]/admin.tsx'));

/** Where a snippet first appears, or -1. */
function at(needle: string): number {
  return SOURCE.indexOf(needle);
}

/** Assert a appears before b, with a message naming both. */
function before(a: string, b: string) {
  const ia = at(a);
  const ib = at(b);
  expect({ snippet: a, found: ia >= 0 }).toEqual({ snippet: a, found: true });
  expect({ snippet: b, found: ib >= 0 }).toEqual({ snippet: b, found: true });
  expect({ first: a, second: b, inOrder: ia < ib }).toEqual({
    first: a,
    second: b,
    inOrder: true,
  });
}

describe('the three bands', () => {
  it('runs share, then watch, then setup', () => {
    before('id="share"', 'id="watch"');
    before('id="watch"', 'id="setup"');
  });

  it('gives each band an anchor the nav can reach', () => {
    for (const id of ['share', 'watch', 'setup']) {
      expect(SOURCE).toContain(`id="${id}"`);
    }
    // The nav is generated from BANDS, so the ids cannot drift apart.
    expect(SOURCE).toContain('href={`#${band.id}`}');
  });
});

describe('share it', () => {
  it('puts the QR code above the gallery style, not below it', () => {
    // The original complaint: the first card on the page was a font picker and
    // the QR code rendered under it.
    before('id="event-qr-code"', '<GalleryStyleSettings');
  });

  it('shows the QR code without a toggle', () => {
    // It used to be `{showQR ? (...) : null}` behind a Show/Hide button.
    expect(SOURCE).not.toContain('showQR');
    expect(SOURCE).not.toContain('setShowQR');
  });

  it('keeps the printables with the code they print', () => {
    before('id="event-qr-code"', '/table-tent');
    before('/table-tent', 'id="watch"');
    before('/brochure', 'id="watch"');
  });

  it('puts moments beside the QR code rather than below the photos', () => {
    // Each moment mints its own QR code. It was eleventh on the page, under the
    // photo grid.
    before('<MomentsManager', 'id="watch"');
    before('<MomentsManager', '<AdminPhotoGrid');
  });
});

describe('watch it', () => {
  it('holds the counts, the queues and the photos', () => {
    for (const snippet of [
      'Total photos',
      '<CommentModeration',
      '<GuestBookModeration',
      '<DownloadShareBuilder',
      '<AdminPhotoGrid',
    ]) {
      before('id="watch"', snippet);
      before(snippet, 'id="setup"');
    }
  });
});

describe('set it up', () => {
  it('holds the settings, the style and the add-ons', () => {
    for (const snippet of [
      '>Event details</h2>',
      '<GalleryStyleSettings',
      'What guests can do',
      'Photo screening',
      'Guest downloads',
      'Guest videos',
      'SharePix Pro',
      'Add-ons',
    ]) {
      before('id="setup"', snippet);
    }
  });

  it('keeps Delete event out of the card with the event name in it', () => {
    // The specific thing being prevented: a host editing the event name, with
    // a Delete event button in the same card.
    const details = at('>Event details</h2>');
    const ending = at('Ending the event');
    const del = at('Delete event');
    expect(details).toBeGreaterThan(-1);
    expect(ending).toBeGreaterThan(-1);
    // Delete lives after the "Ending the event" heading, which is itself the
    // last card on the page.
    expect(del).toBeGreaterThan(ending);
    expect(ending).toBeGreaterThan(details);
  });

  it('puts closing and deleting in the same last card, in that order', () => {
    before('Ending the event', 'Close event');
    before('Close event', 'Delete event');
  });

  it('ends the page with the destructive card', () => {
    // Nothing after it. If a section is ever appended below, this fails and
    // whoever appended it has to decide whether it really belongs past Delete.
    const ending = at('Ending the event');
    expect(SOURCE.slice(ending)).not.toContain('<section id=');
  });
});

describe('confirmations', () => {
  it('scopes every settings message to a card', () => {
    // One shared message split across four cards. Without the scope, saving the
    // event name would print the confirmation in whichever card renders it —
    // which, before the split, was the one three screens below.
    for (const scope of ['details', 'guests', 'addons', 'danger']) {
      expect(SOURCE).toContain(`settingsMsg?.where === '${scope}'`);
    }
  });

  it('never writes a message without saying where it belongs', () => {
    // Every setSettingsMsg call carries a `where`. Counting is enough: a call
    // without one would not typecheck, but this fails sooner and says why.
    const writes = SOURCE.split('setSettingsMsg({').length - 1;
    // `where: '` with the quote, so the state's own type declaration —
    // `where: SettingsScope` — is not counted as a write.
    const scoped = SOURCE.split("where: '").length - 1;
    expect({ writes, scoped }).toEqual({ writes, scoped: writes });
  });
});

describe('nothing was dropped in the move', () => {
  // A restructure that loses a control is worse than the layout it replaced,
  // and it loses it silently. Every interactive thing the page had before is
  // named here once.
  const MUST_KEEP = [
    'Public gallery',
    'Live slideshow',
    'Refresh',
    '<EventQRCode',
    '/table-tent',
    '/brochure',
    '<MomentsManager',
    'Total photos',
    'Hidden from gallery',
    '<CommentModeration',
    '<GuestBookModeration',
    '<DownloadShareBuilder',
    '<AdminPhotoGrid',
    '<HostGuide',
    'Event name',
    'Event date',
    'Where it happened',
    'Save details',
    '<GalleryStyleSettings',
    'Photo screening',
    'Guest downloads',
    'Guest videos',
    'alert-email',
    'Invite a photographer',
    'Add-ons',
    'addon-discount',
    'Something not right with this event?',
    'Ask for more room',
    'Featured Events',
    'Close event',
    'Delete event',
  ];

  it.each(MUST_KEEP)('still has %s', (snippet) => {
    expect(SOURCE).toContain(snippet);
  });
});

describe('the guide meets a new host differently', () => {
  const FULL = readSource('pages/event/[eventId]/admin.tsx');

  it('opens it for an event with no photos', () => {
    expect(codeOnly(FULL)).toContain('photos.length === 0');
    expect(codeOnly(FULL)).toContain('defaultOpen');
  });

  it('renders it before the first band for a new event', () => {
    // The point of opening it is that it is the first thing on the page. Open
    // but eighth would be no better than closed.
    before('defaultOpen', 'id="share"');
  });

  it('still offers it, closed, once photos exist', () => {
    before('photos.length > 0', 'id="watch"');
    // Two renderings, one per branch.
    expect(codeOnly(FULL).split('<HostGuide').length - 1).toBe(2);
  });
});
