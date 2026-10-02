import {
  COVER_PRESETS,
  DEFAULT_SHADE,
  MAX_SHADE,
  MIN_SHADE,
  coverCountdown,
  isCoverImageKey,
  resolveEventCover,
  sanitizeCoverStyle,
} from '../lib/eventCover';
import { contrastRatio, isFontSetKey, normalizeAccent } from '../lib/galleryTheme';
import { STARTER_LOOKS } from '../lib/starterLooks';
import { NO_PER_GUEST_LIMIT_LINE } from '../lib/fairUse';
import { buildPatch } from '../amplify/functions/update-event/settings';
import { canSign, variantOf } from '../amplify/functions/media-url/access';
import { mirrorDecision } from '../amplify/functions/sanitize-upload/mirror';
import { bodyOf, readSource as read } from './sourceGuards';

const EVENT = 'evt-123';
const KEY = `events/${EVENT}/cover/a1b2c3d4e5f6a7b8.jpg`;

describe('the copy has not drifted', () => {
  it('keeps update-event/eventCover.ts identical to lib/ below the header', () => {
    expect(bodyOf(read('amplify/functions/update-event/eventCover.ts'))).toBe(
      bodyOf(read('lib/eventCover.ts')),
    );
  });
});

describe('every preset is readable', () => {
  // The cover's words are always white. A preset that fails this would be a
  // background nobody can read the event's name on.
  it.each(COVER_PRESETS.map((p) => [p.key, p.lightest]))(
    '%s clears WCAG AA for white text',
    (_key, lightest) => {
      expect(contrastRatio('#ffffff', lightest)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('builds every background from fixed values, not from anything stored', () => {
    for (const preset of COVER_PRESETS) {
      expect(preset.background).not.toMatch(/url\(|var\(|expression|;/i);
    }
  });
});

describe('the cover photo has to be this event’s', () => {
  it('accepts a random name under the event’s own cover folder', () => {
    expect(isCoverImageKey(KEY, EVENT)).toBe(true);
    expect(isCoverImageKey(`events/${EVENT}/cover/abcdefgh.webp`, EVENT)).toBe(true);
  });

  it('refuses another event’s media, other folders and path tricks', () => {
    expect(isCoverImageKey(`events/other/cover/a1b2c3d4e5f6a7b8.jpg`, EVENT)).toBe(false);
    expect(isCoverImageKey(`events/${EVENT}/photos/a1b2c3d4e5f6a7b8.jpg`, EVENT)).toBe(false);
    expect(isCoverImageKey(`events/${EVENT}/cover/../../other/x.jpg`, EVENT)).toBe(false);
    expect(isCoverImageKey(`events/${EVENT}/cover/short.jpg`, EVENT)).toBe(false);
    expect(isCoverImageKey(`events/${EVENT}/cover/a1b2c3d4e5f6a7b8.svg`, EVENT)).toBe(false);
    expect(isCoverImageKey(`quarantine/events/${EVENT}/cover/a1b2c3d4e5f6a7b8.jpg`, EVENT)).toBe(
      false,
    );
    expect(isCoverImageKey(KEY, '')).toBe(false);
    expect(isCoverImageKey(KEY, 'a/b')).toBe(false);
    expect(isCoverImageKey(42, EVENT)).toBe(false);
  });
});

describe('sanitizeCoverStyle', () => {
  const clean = (value: unknown) => sanitizeCoverStyle(JSON.stringify(value), EVENT);

  it('keeps the fields it knows, cleaned', () => {
    const result = clean({
      image: KEY,
      preset: 'rose',
      focus: 30.4,
      shade: 60,
      title: '  Sarah   & Ezekiel’s\nWedding ',
      subtitle: 'June 14',
      align: 'left',
      height: 'tall',
      countdown: false,
      somethingElse: '<script>',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.value as string)).toEqual({
      image: KEY,
      preset: 'rose',
      focus: 30,
      shade: 60,
      title: 'Sarah & Ezekiel’s Wedding',
      subtitle: 'June 14',
      align: 'left',
      height: 'tall',
      countdown: false,
    });
  });

  it('never lets the shade go below the readable minimum', () => {
    const low = clean({ shade: 0 });
    const high = clean({ shade: 100 });
    expect(low.ok && JSON.parse(low.value as string).shade).toBe(MIN_SHADE);
    expect(high.ok && JSON.parse(high.value as string).shade).toBe(MAX_SHADE);
  });

  it('clears on empty, and on an object with nothing usable', () => {
    expect(sanitizeCoverStyle('', EVENT)).toEqual({ ok: true, value: null });
    expect(sanitizeCoverStyle(null, EVENT)).toEqual({ ok: true, value: null });
    expect(clean({ align: 'diagonal', title: '   ' })).toEqual({ ok: true, value: null });
  });

  it('refuses what the settings card could never send', () => {
    expect(clean({ preset: 'neon' }).ok).toBe(false);
    expect(clean({ image: 'events/other/cover/a1b2c3d4e5f6a7b8.jpg' }).ok).toBe(false);
    expect(sanitizeCoverStyle('not json', EVENT).ok).toBe(false);
    expect(sanitizeCoverStyle('[1,2]', EVENT).ok).toBe(false);
    expect(sanitizeCoverStyle('x'.repeat(5000), EVENT).ok).toBe(false);
  });

  it('caps the text lengths', () => {
    const result = clean({ title: 'x'.repeat(500), subtitle: 'y'.repeat(500) });
    if (!result.ok) throw new Error('expected ok');
    const parsed = JSON.parse(result.value as string);
    expect(parsed.title).toHaveLength(80);
    expect(parsed.subtitle).toHaveLength(120);
  });
});

describe('resolveEventCover', () => {
  it('resolves nothing, nonsense and another event’s photo to the navy band', () => {
    for (const coverStyle of [
      null,
      '',
      '{bad',
      JSON.stringify({ image: 'events/other/cover/a1b2c3d4e5f6a7b8.jpg' }),
    ]) {
      const cover = resolveEventCover({ id: EVENT, coverStyle });
      expect(cover.customized).toBe(false);
      expect(cover.image).toBeNull();
      expect(cover.preset.key).toBe('navy');
      expect(cover.shade).toBe(DEFAULT_SHADE);
      expect(cover.countdown).toBe(true);
    }
    expect(resolveEventCover(null).customized).toBe(false);
  });

  it('reads a stored cover', () => {
    const cover = resolveEventCover({
      id: EVENT,
      coverStyle: JSON.stringify({ image: KEY, focus: 20, title: 'Hello' }),
    });
    expect(cover).toMatchObject({ image: KEY, focus: 20, title: 'Hello', customized: true });
  });
});

describe('coverCountdown', () => {
  const now = new Date('2026-06-10T12:00:00Z');

  it('counts days to the event', () => {
    expect(coverCountdown({ date: '2026-06-13' }, now)).toBe('3 days to go');
    expect(coverCountdown({ date: '2026-06-11' }, now)).toBe('Tomorrow');
  });

  it('then counts the time left to share', () => {
    expect(
      coverCountdown({ date: '2026-06-10', uploadWindowEndsAt: '2026-06-12T07:30:00Z' }, now),
    ).toBe('1d 19h left to share');
    expect(coverCountdown({ uploadWindowEndsAt: '2026-06-10T17:00:00Z' }, now)).toBe(
      '5h left to share',
    );
    expect(coverCountdown({ uploadWindowEndsAt: '2026-06-10T12:20:00Z' }, now)).toBe(
      'Less than an hour left to share',
    );
  });

  it('says nothing once uploads are over', () => {
    expect(coverCountdown({ uploadWindowEndsAt: '2026-06-01T00:00:00Z' }, now)).toBeNull();
    expect(
      coverCountdown({ uploadWindowEndsAt: '2026-06-20T00:00:00Z', uploadsClosed: true }, now),
    ).toBeNull();
    expect(coverCountdown({}, now)).toBeNull();
    expect(coverCountdown(null, now)).toBeNull();
  });
});

describe('saving a cover through updateEventSettings', () => {
  const state = { photoCount: 12, id: EVENT };

  it('stores the cleaned value, even after photos exist', () => {
    const result = buildPatch({ coverStyle: JSON.stringify({ preset: 'sage' }) }, state);
    expect(result).toEqual({
      ok: true,
      patch: { set: { coverStyle: JSON.stringify({ preset: 'sage' }) }, remove: [] },
    });
  });

  it('clears it with an empty string', () => {
    expect(buildPatch({ coverStyle: '' }, state)).toEqual({
      ok: true,
      patch: { set: {}, remove: ['coverStyle'] },
    });
  });

  it('refuses another event’s photo', () => {
    const result = buildPatch(
      { coverStyle: JSON.stringify({ image: 'events/other/cover/a1b2c3d4e5f6a7b8.jpg' }) },
      state,
    );
    expect(result.ok).toBe(false);
  });

  it('leaves the cover alone when the request does not mention it', () => {
    const result = buildPatch({ commentsEnabled: false, coverStyle: null }, state);
    expect(result.ok && result.patch.remove).not.toContain('coverStyle');
  });
});

describe('serving the cover photo', () => {
  const event = { owner: 'host-sub::host@example.com', guestResolution: 'full' as const };
  const guest = { sub: 'someone-else' };

  it('is its own kind of key', () => {
    expect(variantOf(KEY)).toBe('cover');
  });

  it('is signed for guests, even where they only get thumbnails', () => {
    expect(canSign({ eventId: EVENT, key: KEY, event, caller: guest }).allowed).toBe(true);
    expect(
      canSign({
        eventId: EVENT,
        key: KEY,
        event: { ...event, guestDownloadsBlocked: true, guestResolution: 'small' },
        caller: guest,
      }).allowed,
    ).toBe(true);
  });

  it('goes dark with the gallery and with a closed event', () => {
    expect(
      canSign({ eventId: EVENT, key: KEY, event: { ...event, guestResolution: 'none' }, caller: guest })
        .allowed,
    ).toBe(false);
    expect(
      canSign({ eventId: EVENT, key: KEY, event: { ...event, takenDown: true }, caller: guest })
        .allowed,
    ).toBe(false);
    expect(canSign({ eventId: 'other', key: KEY, event, caller: guest }).allowed).toBe(false);
  });

  it('is mirrored to R2, so it outlives the 90-day S3 copy', () => {
    expect(mirrorDecision({ key: KEY }).mirror).toBe(true);
  });
});

describe('starter looks', () => {
  it('use only values the individual controls accept', () => {
    for (const look of STARTER_LOOKS) {
      expect(isFontSetKey(look.galleryFontSet)).toBe(true);
      expect(COVER_PRESETS.some((p) => p.key === look.coverPreset)).toBe(true);
      if (look.galleryAccent) expect(normalizeAccent(look.galleryAccent)).toBe(look.galleryAccent);
    }
    expect(new Set(STARTER_LOOKS.map((l) => l.key)).size).toBe(STARTER_LOOKS.length);
  });
});

describe('no per-guest limit', () => {
  it('is said on the pricing page, the help centre and to guests uploading', () => {
    expect(NO_PER_GUEST_LIMIT_LINE).toMatch(/^No per-guest limit/);
    expect(read('components/PricingCards.tsx')).toContain('NO_PER_GUEST_LIMIT_LINE');
    expect(read('pages/event/[eventId]/upload.tsx')).toContain('NO_PER_GUEST_LIMIT_LINE');
    expect(read('pages/pricing.tsx')).toMatch(/no per-guest limit/i);
    expect(read('lib/help.ts')).toMatch(/no per-guest limit/i);
  });
});
