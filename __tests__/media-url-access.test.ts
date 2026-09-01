import {
  canSign,
  eventIdOfKey,
  isHostOrAdmin,
  isVideoKey,
  variantOf,
} from '../amplify/functions/media-url/access';

const EVENT = 'evt-1';
const owner = 'sub-host::host@example.com';
const host = { sub: 'sub-host' };
const guest = { sub: null };
const admin = { sub: 'sub-other', groups: ['ADMINS'] };

const original = `events/${EVENT}/photos/abc.jpg`;
const preview = `events/${EVENT}/previews/abc-preview.jpg`;
const thumb = `events/${EVENT}/thumbs/abc-thumb.jpg`;
const video = `events/${EVENT}/photos/clip.mp4`;

const openEvent = { owner, guestResolution: 'full' as const };

function sign(key: string, caller: unknown, event = openEvent, eventId = EVENT) {
  return canSign({ eventId, key, event, caller: caller as never });
}

describe('key parsing', () => {
  it('reads the event id out of the key', () => {
    expect(eventIdOfKey(original)).toBe(EVENT);
    expect(eventIdOfKey('nonsense')).toBe('');
    expect(eventIdOfKey('')).toBe('');
  });

  it('classifies the three variants and rejects anything else', () => {
    expect(variantOf(original)).toBe('original');
    expect(variantOf(preview)).toBe('preview');
    expect(variantOf(thumb)).toBe('thumb');
    expect(variantOf('events/evt-1/secrets/x')).toBe('unknown');
    expect(variantOf('../../etc/passwd')).toBe('unknown');
  });

  it('spots videos by extension, case-insensitively', () => {
    expect(isVideoKey(video)).toBe(true);
    expect(isVideoKey(`events/${EVENT}/photos/CLIP.MOV`)).toBe(true);
    expect(isVideoKey(original)).toBe(false);
  });
});

describe('canSign — the cross-event leak this prevents', () => {
  it('refuses a key that belongs to a different event', () => {
    // Both the event id and the key come from the request; without this the
    // pairing could be forged to read another event's photos.
    const otherKey = 'events/evt-2/photos/abc.jpg';
    expect(sign(otherKey, host).allowed).toBe(false);
  });

  it('refuses even the host a key from someone else’s event', () => {
    expect(sign('events/evt-2/photos/abc.jpg', host, openEvent, EVENT).allowed).toBe(false);
  });

  it('refuses paths that are not a known variant', () => {
    for (const key of ['', 'events/evt-1/', 'other/evt-1/photos/a.jpg', `events/${EVENT}/x/a.jpg`]) {
      expect(sign(key, host).allowed).toBe(false);
    }
  });
});

describe('canSign — the host', () => {
  it('gets every variant of their own event', () => {
    for (const key of [original, preview, thumb, video]) {
      expect(sign(key, host)).toEqual({ allowed: true, host: true });
    }
  });

  it('keeps full access even when downloads are withheld from guests', () => {
    const withheld = { ...openEvent, guestDownloadsBlocked: true };
    expect(sign(original, host, withheld)).toEqual({ allowed: true, host: true });
  });

  it('keeps access after the guest window has closed', () => {
    const closed = { ...openEvent, guestResolution: 'none' as const };
    expect(sign(original, host, closed).allowed).toBe(true);
  });

  it('treats an admin as a host', () => {
    expect(sign(video, admin)).toEqual({ allowed: true, host: true });
  });
});

describe('canSign — guests', () => {
  it('gets stills while the gallery is open', () => {
    expect(sign(original, guest)).toEqual({ allowed: true, host: false });
    expect(sign(preview, guest).allowed).toBe(true);
    expect(sign(thumb, guest).allowed).toBe(true);
  });

  it('never gets a video', () => {
    // Matches the gallery: a video streams at full size on every play.
    expect(sign(video, guest).allowed).toBe(false);
  });

  it('gets nothing once the gallery has closed to them', () => {
    const closed = { ...openEvent, guestResolution: 'none' as const };
    for (const key of [original, preview, thumb]) {
      expect(sign(key, guest, closed).allowed).toBe(false);
    }
  });

  it('gets the thumbnail only when the host has withheld downloads', () => {
    const withheld = { ...openEvent, guestDownloadsBlocked: true };
    expect(sign(original, guest, withheld).allowed).toBe(false);
    expect(sign(preview, guest, withheld).allowed).toBe(false);
    expect(sign(thumb, guest, withheld).allowed).toBe(true);
  });

  it('gets the thumbnail only in the post-window low-resolution phase', () => {
    const small = { ...openEvent, guestResolution: 'small' as const };
    expect(sign(original, guest, small).allowed).toBe(false);
    expect(sign(thumb, guest, small).allowed).toBe(true);
  });

  it('is not treated as the host of an ownerless event', () => {
    // An empty owner must not match a caller with no sub.
    const ownerless = { owner: '', guestResolution: 'full' as const };
    expect(sign(video, guest, ownerless).allowed).toBe(false);
  });
});

describe('isHostOrAdmin', () => {
  it('matches the owner sub and the admin group, nothing else', () => {
    expect(isHostOrAdmin(host, owner)).toBe(true);
    expect(isHostOrAdmin(admin, owner)).toBe(true);
    expect(isHostOrAdmin({ sub: 'someone' }, owner)).toBe(false);
    expect(isHostOrAdmin(guest, owner)).toBe(false);
    expect(isHostOrAdmin(guest, '')).toBe(false);
    expect(isHostOrAdmin(null, owner)).toBe(false);
  });
});

describe('canSign — refusals are indistinguishable', () => {
  it('gives one message for wrong event, unknown path, and not allowed', () => {
    const wrongEvent = sign('events/evt-2/photos/a.jpg', host);
    const unknownPath = sign(`events/${EVENT}/nope/a.jpg`, host);
    const notAllowed = sign(video, guest);
    expect(wrongEvent).toEqual(unknownPath);
    expect(unknownPath).toEqual(notAllowed);
  });
});
