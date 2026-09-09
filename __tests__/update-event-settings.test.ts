import {
  EDITABLE_FIELDS,
  MODERATION_MODES,
  buildPatch,
  formatEventLocation,
  mayEdit,
  sanitizeEventDate,
  type SettingsRequest,
} from '../amplify/functions/update-event/settings';

const EMPTY = { photoCount: 0 };
const WITH_PHOTOS = { photoCount: 12 };

function patch(request: SettingsRequest, event = EMPTY) {
  const result = buildPatch(request, event);
  if (!result.ok) throw new Error(`expected a patch, got: ${result.reason}`);
  return result.patch;
}

describe('the allow-list is the whole surface', () => {
  it('names only the settings a host owns', () => {
    expect(EDITABLE_FIELDS.sort()).toEqual([
      'alertEmail',
      'date',
      'guestDownloadsBlocked',
      'location',
      'moderationMode',
      'name',
      // Presentation only — how the event's QR code looks. Added when QR
      // styling became something a host saves rather than something that
      // vanished on reload.
      'qrColor',
      'qrDotStyle',
      'qrLogo',
      'uploadsClosed',
      'videoUploadsEnabled',
    ]);
  });

  it('contains nothing priced, counted, or dated by the lifecycle', () => {
    // These are the fields the old blanket owner-update rule exposed. Any of
    // them appearing here would put the hole straight back.
    const forbidden = [
      'paid',
      'tier',
      'photoLimit',
      'videoLimit',
      'extraPhotoCredits',
      'extraVideoCredits',
      'photoCount',
      'videoCount',
      'accessExpiresAt',
      'uploadWindowEndsAt',
      'guestDownloadEnabled',
      'liveSlideshowEnabled',
      'eventCode',
      'owner',
      'createdBy',
      // Admin-only: a host must not be able to dress their event up as
      // someone else's branded experience.
      'themeKey',
    ];
    for (const field of forbidden) expect(EDITABLE_FIELDS).not.toContain(field);
  });

  it('writes nothing outside the allow-list, whatever the request carries', () => {
    const hostile = {
      name: 'Fine',
      paid: true,
      tier: 'premium',
      photoLimit: 999999,
      photoCount: 0,
      uploadWindowEndsAt: '2099-01-01T00:00:00Z',
    } as unknown as SettingsRequest;
    const written = patch(hostile);
    expect(Object.keys(written.set)).toEqual(['name']);
    expect(written.remove).toEqual([]);
  });
});

describe('name and date', () => {
  it('cleans and bounds the name', () => {
    expect(patch({ name: '  Sam & Riley  ' }).set.name).toBe('Sam & Riley');
    expect(patch({ name: 'x'.repeat(200) }).set.name).toHaveLength(80);
    expect(patch({ name: 'Wedding\r\nBcc: x@example.com' }).set.name).toBe(
      'Wedding Bcc: x@example.com',
    );
  });

  it('refuses an empty name rather than clearing it', () => {
    const result = buildPatch({ name: '   ' }, EMPTY);
    expect(result).toEqual({ ok: false, reason: 'Enter an event name.' });
  });

  it('locks the name and date once guests have uploaded', () => {
    // The dashboard hides the fields; this is what actually enforces it.
    expect(buildPatch({ name: 'Renamed' }, WITH_PHOTOS).ok).toBe(false);
    expect(buildPatch({ date: '2026-06-01' }, WITH_PHOTOS).ok).toBe(false);
  });

  it('leaves the location editable after photos exist', () => {
    // Location is only a label, so a host who forgot it shouldn't be stuck.
    const result = buildPatch({ city: 'Minneapolis', state: 'MN' }, WITH_PHOTOS);
    expect(result.ok).toBe(true);
  });

  it('clears the date when it is sent empty', () => {
    expect(patch({ date: '' }).remove).toEqual(['date']);
  });

  it('refuses a date that is not a real calendar date', () => {
    expect(buildPatch({ date: '2026-02-30' }, EMPTY).ok).toBe(false);
    expect(buildPatch({ date: 'next June' }, EMPTY).ok).toBe(false);
    expect(sanitizeEventDate('2026-06-01')).toBe('2026-06-01');
  });
});

describe('location', () => {
  it('rebuilds the single label from both parts', () => {
    expect(patch({ city: 'Minneapolis', state: 'MN' }).set.location).toBe('Minneapolis, MN');
    expect(patch({ city: 'St. Paul' }).set.location).toBe('St. Paul');
    expect(formatEventLocation("Coeur d'Alene", 'ID')).toBe("Coeur d'Alene, ID");
  });

  it('clears the label when both parts come back empty', () => {
    expect(patch({ city: '', state: '' }).remove).toEqual(['location']);
  });

  it('drops anything that is not a place name', () => {
    expect(patch({ city: '<script>x</script>', state: '' }).set.location).toBe('script x script');
  });
});

describe('screening and alerts', () => {
  it('accepts only the modes that exist', () => {
    for (const mode of MODERATION_MODES) {
      expect(patch({ moderationMode: mode }).set.moderationMode).toBe(mode);
    }
    expect(patch({ moderationMode: ' REVIEW ' }).set.moderationMode).toBe('review');
    expect(buildPatch({ moderationMode: 'off' }, EMPTY).ok).toBe(false);
    expect(buildPatch({ moderationMode: '' }, EMPTY).ok).toBe(false);
  });

  it('stores a valid alert address and clears an empty one', () => {
    expect(patch({ alertEmail: 'host@example.com' }).set.alertEmail).toBe('host@example.com');
    expect(patch({ alertEmail: '' }).remove).toEqual(['alertEmail']);
  });

  it('refuses an address that could not receive mail', () => {
    expect(buildPatch({ alertEmail: 'not-an-address' }, EMPTY).ok).toBe(false);
    // A newline here would end up in an email header.
    expect(buildPatch({ alertEmail: 'a@b.com\nBcc: c@d.com' }, EMPTY).ok).toBe(false);
  });
});

describe('the toggles', () => {
  it('writes each one as a boolean', () => {
    expect(patch({ uploadsClosed: true }).set.uploadsClosed).toBe(true);
    expect(patch({ guestDownloadsBlocked: false }).set.guestDownloadsBlocked).toBe(false);
    expect(patch({ videoUploadsEnabled: true }).set.videoUploadsEnabled).toBe(true);
  });

  it('refuses a non-boolean rather than coercing it', () => {
    const sneaky = { uploadsClosed: 'false' } as unknown as SettingsRequest;
    expect(buildPatch(sneaky, EMPTY).ok).toBe(false);
  });

  it('leaves a toggle alone when it is not mentioned', () => {
    const written = patch({ uploadsClosed: true });
    expect(written.set).not.toHaveProperty('guestDownloadsBlocked');
    expect(written.set).not.toHaveProperty('videoUploadsEnabled');
  });
});

describe('empty requests', () => {
  it('refuses a request that would write nothing', () => {
    expect(buildPatch({}, EMPTY)).toEqual({ ok: false, reason: 'Nothing to update.' });
  });
});

describe('who may edit', () => {
  const owner = 'sub-host::host@example.com';

  it('lets the owner and any admin through', () => {
    expect(mayEdit({ sub: 'sub-host' }, owner)).toBe(true);
    expect(mayEdit({ sub: 'someone-else', groups: ['ADMINS'] }, owner)).toBe(true);
  });

  it('keeps everyone else out', () => {
    expect(mayEdit({ sub: 'sub-other' }, owner)).toBe(false);
    expect(mayEdit({ sub: null }, owner)).toBe(false);
    expect(mayEdit(null, owner)).toBe(false);
    expect(mayEdit({ sub: 'sub-host' }, '')).toBe(false);
  });

  it('matches the whole sub, not a substring of the owner string', () => {
    // 'sub-h' appears inside 'sub-host'; a substring check would let it in.
    expect(mayEdit({ sub: 'sub-h' }, owner)).toBe(false);
  });
});

/**
 * AppSync hands the function `null` for an argument the caller did not send,
 * not `undefined`. Every guard here used to read `field !== undefined`, which
 * made "they left it alone" indistinguishable from "they sent nothing for it".
 *
 * A host picking a gallery font was told to enter an event name. That was the
 * visible half: the name check runs first and returns early, which is the only
 * reason the rest was not worse. Read as sent-and-empty, an absent `city`
 * cleared the location, an absent `alertEmail` cleared the alert address, and
 * absent QR fields reset the branding to defaults — so one setting changed
 * would have quietly taken several others with it.
 *
 * Nothing in the old suite passed a null, which is why it shipped.
 */
describe('a field the caller did not send', () => {
  /** What the mutation actually delivers for a one-field change. */
  function onlyFontSet(): SettingsRequest {
    return {
      name: null,
      date: null,
      city: null,
      state: null,
      moderationMode: null,
      alertEmail: null,
      videoUploadsEnabled: null,
      guestDownloadsBlocked: null,
      uploadsClosed: null,
      qrDotStyle: null,
      qrColor: null,
      qrLogo: null,
      galleryFontSet: 'elegant',
      galleryLayout: null,
      galleryAccent: null,
      reactionsEnabled: null,
      commentsEnabled: null,
    } as SettingsRequest;
  }

  it('lets a host pick a font without being asked for an event name', () => {
    expect(patch(onlyFontSet())).toEqual({ set: { galleryFontSet: 'elegant' }, remove: [] });
  });

  it('writes nothing but the field that was sent', () => {
    const result = patch(onlyFontSet());
    expect(Object.keys(result.set)).toEqual(['galleryFontSet']);
    // The destructive half: these were being cleared by their own absence.
    expect(result.remove).toEqual([]);
  });

  it('does not read an absent name as an attempt to rename the event', () => {
    // The event has photos, so a real rename is refused. Sending no name at all
    // is not a rename and must not trip that lock.
    const result = buildPatch(onlyFontSet(), WITH_PHOTOS);
    expect(result.ok).toBe(true);
  });

  it('still refuses a name that was genuinely sent empty', () => {
    expect(buildPatch({ name: '   ' } as SettingsRequest, EMPTY)).toEqual({
      ok: false,
      reason: 'Enter an event name.',
    });
  });

  it('still clears a field when an empty string is sent deliberately', () => {
    // Empty string is the clear signal, and stays one — lib/api.ts converts a
    // caller's null to '' precisely to mean this.
    expect(patch({ alertEmail: '' } as SettingsRequest).remove).toContain('alertEmail');
    expect(patch({ galleryAccent: '' } as SettingsRequest).remove).toContain('galleryAccent');
  });

  it('reports nothing to update when every field is absent', () => {
    const allNull = { ...onlyFontSet(), galleryFontSet: null } as SettingsRequest;
    expect(buildPatch(allNull, EMPTY)).toEqual({ ok: false, reason: 'Nothing to update.' });
  });

  it('accepts a boolean sent as false rather than treating it as absent', () => {
    // false is a real answer, and the guard must not confuse it with "unset".
    expect(patch({ uploadsClosed: false } as SettingsRequest).set).toEqual({
      uploadsClosed: false,
    });
  });

  it('leaves QR branding alone when none of its fields were sent', () => {
    const result = patch(onlyFontSet());
    expect(result.set.qrDotStyle).toBeUndefined();
    expect(result.set.qrColor).toBeUndefined();
    expect(result.remove).not.toContain('qrLogo');
  });
});
