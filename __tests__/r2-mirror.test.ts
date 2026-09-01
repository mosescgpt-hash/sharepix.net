import {
  mirrorConfigured,
  mirrorDecision,
  r2KeyFor,
} from '../amplify/functions/sanitize-upload/mirror';

const ORIGINAL = 'events/evt-1/photos/abc123.jpg';
const PREVIEW = 'events/evt-1/previews/abc123-preview.jpg';
const THUMB = 'events/evt-1/thumbs/abc123-thumb.jpg';
const VIDEO = 'events/evt-1/photos/clip.mp4';

describe('mirrorDecision — the leak this prevents', () => {
  it('does NOT mirror a strippable original on its first pass', () => {
    // This is the whole point of the module. The guest's upload still has its
    // GPS in it; stripping happens next and fires a second event. Copying now
    // would put the un-stripped file in R2 and serve it to guests.
    const decision = mirrorDecision({ key: ORIGINAL, strippable: true, sanitized: false });
    expect(decision.mirror).toBe(false);
    expect(decision.reason).toBe('awaiting-sanitized-rewrite');
  });

  it('mirrors the same original once the sanitized rewrite arrives', () => {
    const decision = mirrorDecision({ key: ORIGINAL, strippable: true, sanitized: true });
    expect(decision.mirror).toBe(true);
    expect(decision.reason).toBe('sanitized-original');
  });

  it('treats a missing sanitized flag as not-yet-stripped', () => {
    // Absent metadata must never be read as "already clean".
    expect(mirrorDecision({ key: ORIGINAL, strippable: true }).mirror).toBe(false);
  });
});

describe('mirrorDecision — everything else', () => {
  it('mirrors previews and thumbs immediately', () => {
    // Canvas re-encodes carry no metadata across, and these are what the
    // gallery actually serves, so they are the most valuable thing in R2.
    expect(mirrorDecision({ key: PREVIEW })).toEqual({
      mirror: true,
      reason: 'derived-variant',
    });
    expect(mirrorDecision({ key: THUMB })).toEqual({
      mirror: true,
      reason: 'derived-variant',
    });
  });

  it('mirrors an original that is never rewritten', () => {
    // A video or PNG is written once, so waiting for a rewrite would mean
    // waiting forever and never mirroring it at all.
    expect(mirrorDecision({ key: VIDEO, strippable: false })).toEqual({
      mirror: true,
      reason: 'not-strippable',
    });
  });

  it('never mirrors a rejected upload, whatever else is true of it', () => {
    for (const key of [ORIGINAL, PREVIEW, THUMB, VIDEO]) {
      for (const sanitized of [true, false]) {
        expect(mirrorDecision({ key, rejected: true, sanitized, strippable: true }).mirror).toBe(
          false,
        );
      }
    }
  });

  it('ignores keys outside the event prefixes', () => {
    for (const key of ['', 'other/thing.jpg', 'events/', 'eventsevt-1/photos/x.jpg']) {
      expect(mirrorDecision({ key }).mirror).toBe(false);
    }
  });

  it('does not confuse a lookalike prefix for a derived variant', () => {
    // "previews" must be its own path segment, not a substring of the id.
    expect(mirrorDecision({ key: 'events/evt-1/photos/previews-of-me.jpg', strippable: true }))
      .toEqual({ mirror: false, reason: 'awaiting-sanitized-rewrite' });
  });
});

describe('r2KeyFor', () => {
  it('keeps the key identical across both stores', () => {
    expect(r2KeyFor(ORIGINAL)).toBe(ORIGINAL);
    expect(r2KeyFor(PREVIEW)).toBe(PREVIEW);
  });
});

describe('mirrorConfigured', () => {
  const full = {
    R2_ACCOUNT_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    R2_BUCKET: 'sharepix',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
  };

  it('is on only when every value is present', () => {
    expect(mirrorConfigured(full)).toBe(true);
  });

  it('is off when any single value is missing or blank', () => {
    for (const field of Object.keys(full) as (keyof typeof full)[]) {
      expect(mirrorConfigured({ ...full, [field]: '' })).toBe(false);
      const without = { ...full };
      delete without[field];
      expect(mirrorConfigured(without)).toBe(false);
    }
  });

  it('is off with no configuration at all, so the feature is inert by default', () => {
    expect(mirrorConfigured({})).toBe(false);
  });
});
