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
