import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  cleanText,
  containsLink,
  entryNeedsReview,
  entryVisibleToGuests,
  guestBookAvailable,
  guestBookIncludedInTier,
  guestBookPurchasable,
  screenEntryText,
  validateEntry,
} from '../lib/guestBook';

describe('who has a guest book', () => {
  it('includes it on Premium and Corporate', () => {
    expect(guestBookIncludedInTier('premium')).toBe(true);
    expect(guestBookIncludedInTier('corporate')).toBe(true);
  });

  it('does not include it on the cheaper plans', () => {
    expect(guestBookIncludedInTier('starter')).toBe(false);
    expect(guestBookIncludedInTier('standard')).toBe(false);
  });

  it('reads the tier case- and space-insensitively', () => {
    // Tier ids come off an event row written months ago; don't be brittle.
    expect(guestBookIncludedInTier(' Premium ')).toBe(true);
    expect(guestBookIncludedInTier('PREMIUM')).toBe(true);
  });

  it('treats a missing tier as not included', () => {
    expect(guestBookIncludedInTier(null)).toBe(false);
    expect(guestBookIncludedInTier('')).toBe(false);
  });

  it('turns on for a cheaper plan that bought the add-on', () => {
    expect(guestBookAvailable({ tier: 'starter', guestBookEnabled: true })).toBe(true);
  });

  it('stays off for a cheaper plan that has not', () => {
    expect(guestBookAvailable({ tier: 'starter' })).toBe(false);
    expect(guestBookAvailable({ tier: 'standard', guestBookEnabled: false })).toBe(false);
  });

  it('is off for an event we know nothing about', () => {
    // A missing event must never read as "has the paid feature".
    expect(guestBookAvailable(null)).toBe(false);
    expect(guestBookAvailable(undefined)).toBe(false);
  });

  it('only counts a real boolean true as bought', () => {
    // A truthy string off a DynamoDB row must not unlock a paid feature.
    expect(guestBookAvailable({ tier: 'starter', guestBookEnabled: 'yes' as never })).toBe(false);
  });
});

describe('who can still be sold the add-on', () => {
  it('offers it to Starter and Standard', () => {
    expect(guestBookPurchasable({ tier: 'starter' })).toBe(true);
    expect(guestBookPurchasable({ tier: 'standard' })).toBe(true);
  });

  it('never sells it to a plan that already includes it', () => {
    expect(guestBookPurchasable({ tier: 'premium' })).toBe(false);
    expect(guestBookPurchasable({ tier: 'corporate' })).toBe(false);
  });

  it('never sells it twice', () => {
    expect(guestBookPurchasable({ tier: 'starter', guestBookEnabled: true })).toBe(false);
  });
});

describe('cleaning what a guest typed', () => {
  it('trims and collapses runs of whitespace in a name', () => {
    expect(cleanText('  Maya   Patel  ', MAX_NAME_LENGTH)).toBe('Maya Patel');
  });

  it('strips control characters', () => {
    // The invisible ones are the point: nobody types them, and they are how a
    // length check or a log line gets smuggled past.
    const nasty = 'Ma\u0000ya\u001F\u007F';
    expect(cleanText(nasty, MAX_NAME_LENGTH)).toBe('Maya');
  });

  it('strips C1 controls too', () => {
    expect(cleanText('Ma\u0085ya\u009F', MAX_NAME_LENGTH)).toBe('Maya');
  });

  it('flattens newlines out of a name', () => {
    expect(cleanText('Maya\nPatel', MAX_NAME_LENGTH)).toBe('Maya Patel');
  });

  it('keeps paragraphs in a message', () => {
    expect(cleanText('One.\n\nTwo.', MAX_MESSAGE_LENGTH, true)).toBe('One.\n\nTwo.');
  });

  it('caps padding out a message with blank lines', () => {
    expect(cleanText('One.\n\n\n\n\n\nTwo.', MAX_MESSAGE_LENGTH, true)).toBe('One.\n\nTwo.');
  });

  it('still strips tabs and controls when newlines are allowed', () => {
    expect(cleanText('One.\t\tTwo.\u0000', MAX_MESSAGE_LENGTH, true)).toBe('One. Two.');
  });

  it('caps the length rather than trusting the caller', () => {
    expect(cleanText('x'.repeat(500), MAX_NAME_LENGTH)).toHaveLength(MAX_NAME_LENGTH);
  });

  it('returns empty for anything that is not a string', () => {
    // The Lambda gets whatever GraphQL passed through; nothing is guaranteed.
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(cleanText(value, MAX_NAME_LENGTH)).toBe('');
    }
  });
});

describe('spotting links', () => {
  it('catches an explicit URL', () => {
    expect(containsLink('see http://spam.example/x')).toBe(true);
    expect(containsLink('see https://spam.example/x')).toBe(true);
  });

  it('catches a www prefix', () => {
    expect(containsLink('go to www.spam.example')).toBe(true);
  });

  it('catches a bare domain', () => {
    expect(containsLink('cheap-watches.shop has deals')).toBe(true);
  });

  it('leaves an ordinary heartfelt note alone', () => {
    // False positives here are expensive: a flagged note is one the couple
    // does not see until they go looking.
    expect(containsLink('Congratulations to Mr. and Mrs. Rivera!')).toBe(false);
    expect(containsLink('What a day. So happy for you both.')).toBe(false);
    expect(containsLink('Love from the Smiths — see you at brunch.')).toBe(false);
  });
});

describe('screening a note', () => {
  it('passes a clean note', () => {
    expect(screenEntryText('Congratulations!', 'review')).toEqual({ status: 'ok', reasons: [] });
  });

  it('holds a note with a link', () => {
    expect(screenEntryText('buy at www.spam.example', 'review')).toEqual({
      status: 'flagged',
      reasons: ['link'],
    });
  });

  it('screens by default when the mode is missing', () => {
    // A missing moderationMode means 'review' everywhere else in the product.
    expect(screenEntryText('buy at www.spam.example', null).status).toBe('flagged');
    expect(screenEntryText('buy at www.spam.example', undefined).status).toBe('flagged');
  });

  it('skips screening when the host asked for allow_all', () => {
    expect(screenEntryText('buy at www.spam.example', 'allow_all').status).toBe('ok');
  });
});

describe('validating an entry', () => {
  it('accepts a signed note', () => {
    const result = validateEntry({ name: 'Maya', message: 'Beautiful day!' });
    expect(result).toEqual({
      ok: true,
      entry: { name: 'Maya', message: 'Beautiful day!', photoId: null },
    });
  });

  it('accepts a photo with no words', () => {
    // "Note, photo, or a short video message" — the media can be the message.
    const result = validateEntry({ name: 'Dev', photoId: 'photo-1' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.photoId).toBe('photo-1');
  });

  it('refuses an unsigned note', () => {
    const result = validateEntry({ message: 'Congratulations!' });
    expect(result.ok).toBe(false);
  });

  it('refuses a name that is only whitespace or controls', () => {
    expect(validateEntry({ name: '   ', message: 'hi' }).ok).toBe(false);
    expect(validateEntry({ name: '\u0000\u001F', message: 'hi' }).ok).toBe(false);
  });

  it('refuses an entry that says nothing at all', () => {
    expect(validateEntry({ name: 'Maya' }).ok).toBe(false);
    expect(validateEntry({ name: 'Maya', message: '   ' }).ok).toBe(false);
  });

  it('caps an over-long note rather than rejecting it', () => {
    // Someone pasting a long message should not lose the whole thing.
    const result = validateEntry({ name: 'Maya', message: 'x'.repeat(5000) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.message).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it('drops an absurd photo id instead of storing it', () => {
    const result = validateEntry({ name: 'Maya', message: 'hi', photoId: 'x'.repeat(500) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.photoId).toBeNull();
  });

  it('ignores a non-string photo id', () => {
    const result = validateEntry({ name: 'Maya', message: 'hi', photoId: { evil: true } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.photoId).toBeNull();
  });
});

describe('what guests see', () => {
  it('shows a clean entry', () => {
    expect(entryVisibleToGuests({ moderationStatus: 'ok' })).toBe(true);
  });

  it('shows an entry with no verdict at all', () => {
    // A screening change must never blank an album that was already published.
    expect(entryVisibleToGuests({})).toBe(true);
  });

  it('hides a flagged entry', () => {
    expect(entryVisibleToGuests({ moderationStatus: 'flagged' })).toBe(false);
  });

  it('shows one the host released', () => {
    expect(entryVisibleToGuests({ moderationStatus: 'released' })).toBe(true);
  });

  it('hides one the host hid, whatever the screener said', () => {
    // The host's decision is the last word.
    expect(entryVisibleToGuests({ moderationStatus: 'ok', hidden: true })).toBe(false);
    expect(entryVisibleToGuests({ moderationStatus: 'released', hidden: true })).toBe(false);
  });
});

describe('what the host still has to look at', () => {
  it('lists a flagged entry', () => {
    expect(entryNeedsReview({ moderationStatus: 'flagged' })).toBe(true);
  });

  it('drops one they already hid', () => {
    expect(entryNeedsReview({ moderationStatus: 'flagged', hidden: true })).toBe(false);
  });

  it('drops a clean one', () => {
    expect(entryNeedsReview({ moderationStatus: 'ok' })).toBe(false);
  });
});
