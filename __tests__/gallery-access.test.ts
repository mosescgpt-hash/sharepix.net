import { readFileSync } from 'fs';
import { join } from 'path';
import * as gate from '../amplify/functions/gallery-access/galleryGate';
import { newLinkKey } from '../amplify/functions/gallery-access/linkKey';
import * as listVis from '../amplify/functions/list-event-photos/visibility';
import { sharedGalleryFor } from '../amplify/functions/booth-gallery/sharedGallery';
import { videoStatusFor } from '../amplify/functions/create-event-photo/moderation';
import { buildPatch, type SettingsRequest } from '../amplify/functions/update-event/settings';
import * as client from '../lib/galleryAccess';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('link keys', () => {
  it('makes a fresh 22-character URL-safe key each time', () => {
    const a = newLinkKey();
    expect(a).toMatch(gate.LINK_KEY_PATTERN);
    expect(a).not.toBe(newLinkKey());
    expect(Buffer.from(a, 'base64url')).toHaveLength(16);
  });

  it('matches only the exact current key', () => {
    const key = newLinkKey();
    expect(gate.linkKeyMatches(key, key)).toBe(true);
    expect(gate.linkKeyMatches(key, newLinkKey())).toBe(false);
  });

  it('refuses a missing, malformed or wrong-length key without throwing', () => {
    const key = newLinkKey();
    for (const bad of [undefined, null, '', 'short', `${key}x`, '!'.repeat(22), 42 as unknown as string]) {
      expect(gate.linkKeyMatches(key, bad as string)).toBe(false);
      expect(gate.linkKeyMatches(bad as string, key)).toBe(false);
    }
    expect(gate.linkKeyMatches(undefined, undefined)).toBe(false);
  });
});

describe('pause and the link key rule', () => {
  it('is paused only when the host said so', () => {
    expect(gate.sharingPaused({})).toBe(false);
    expect(gate.sharingPaused({ sharingPaused: false })).toBe(false);
    expect(gate.sharingPaused({ sharingPaused: null })).toBe(false);
    expect(gate.sharingPaused({ sharingPaused: true })).toBe(true);
  });

  it('asks for a key only once the QR code was replaced, so existing events keep working', () => {
    expect(gate.linkRequired({})).toBe(false);
    expect(gate.linkRequired({ galleryLinkSet: false })).toBe(false);
    expect(gate.linkRequired({ galleryLinkSet: true })).toBe(true);
  });

  it('keeps a download share until the QR code is replaced, then voids older ones', () => {
    const rotated = { linkRotatedAt: '2026-06-02T12:00:00.000Z' };
    expect(gate.shareIsCurrent('2020-01-01T00:00:00Z', {})).toBe(true);
    expect(gate.shareIsCurrent(undefined, {})).toBe(true);
    expect(gate.shareIsCurrent('2026-06-02T11:59:59.000Z', rotated)).toBe(false);
    expect(gate.shareIsCurrent('2026-06-02T12:00:00.000Z', rotated)).toBe(true);
    expect(gate.shareIsCurrent('2026-06-03T00:00:00.000Z', rotated)).toBe(true);
  });

  it('voids a share it cannot date once the QR code has been replaced', () => {
    const rotated = { linkRotatedAt: '2026-06-02T12:00:00.000Z' };
    expect(gate.shareIsCurrent(undefined, rotated)).toBe(false);
    expect(gate.shareIsCurrent('not a date', rotated)).toBe(false);
  });
});

describe('who gets past the gate', () => {
  const guest = {
    privileged: false,
    shared: false,
    paused: false,
    viewBlocked: false,
    audience: 'everyone' as const,
    linkRequired: false,
    keyValid: false,
  };
  const gateFor = listVis.galleryGateFor;

  it('opens for an ordinary guest, and for a guest with the current key', () => {
    expect(gateFor(guest)).toBe('open');
    expect(gateFor({ ...guest, linkRequired: true, keyValid: true })).toBe('open');
  });

  it('asks for the current link when the QR code was replaced and the guest has none', () => {
    expect(gateFor({ ...guest, linkRequired: true })).toBe('key');
  });

  it('is paused for every guest whatever else is true, key or not', () => {
    expect(gateFor({ ...guest, paused: true })).toBe('paused');
    expect(gateFor({ ...guest, paused: true, linkRequired: true, keyValid: true })).toBe('paused');
    expect(gateFor({ ...guest, paused: true, shared: true })).toBe('paused');
  });

  it('blocks when viewing is off or the gallery is host-only, ahead of the key', () => {
    expect(gateFor({ ...guest, viewBlocked: true })).toBe('blocked');
    expect(gateFor({ ...guest, audience: 'host' })).toBe('blocked');
    expect(gateFor({ ...guest, viewBlocked: true, linkRequired: true, keyValid: true })).toBe('blocked');
  });

  it('never holds up the host or an admin, even while paused', () => {
    const shut = { ...guest, paused: true, viewBlocked: true, linkRequired: true, audience: 'host' as const };
    expect(gateFor({ ...shut, privileged: true })).toBe('open');
  });

  it('lets a current download share past view and key, but not past a pause', () => {
    const shut = { ...guest, viewBlocked: true, linkRequired: true, audience: 'host' as const };
    expect(gateFor({ ...shut, shared: true })).toBe('open');
    expect(gateFor({ ...shut, shared: true, paused: true })).toBe('paused');
  });
});

describe('the Booth shared gallery follows the same gate', () => {
  const input = { eventId: 'evt 1', audience: null, takenDown: false };

  it('links to the gallery with no note when nothing is restricted', () => {
    expect(sharedGalleryFor(input)).toEqual({ sharedGalleryPath: '/event/evt%201', sharedGalleryMessage: null });
  });

  it('drops the link when guests cannot view, whatever the audience', () => {
    expect(sharedGalleryFor({ ...input, viewBlocked: true }).sharedGalleryPath).toBeNull();
    expect(sharedGalleryFor({ ...input, audience: 'host' }).sharedGalleryPath).toBeNull();
  });

  it('drops the link and says so while sharing is paused', () => {
    const result = sharedGalleryFor({ ...input, paused: true });
    expect(result.sharedGalleryPath).toBeNull();
    expect(result.sharedGalleryMessage).toMatch(/paused/i);
  });

  it('keeps the link but points at the current QR code once it was replaced, and never carries a key', () => {
    const result = sharedGalleryFor({ ...input, linkRequired: true });
    expect(result.sharedGalleryPath).toBe('/event/evt%201');
    expect(result.sharedGalleryMessage).toMatch(/QR code or link/);
    expect(result.sharedGalleryPath).not.toMatch(/#|k=/);
  });

  it('shows nothing for a closed event', () => {
    expect(sharedGalleryFor({ ...input, takenDown: true })).toEqual({
      sharedGalleryPath: null,
      sharedGalleryMessage: null,
    });
  });
});

describe('guest videos wait for the host', () => {
  it('holds a guest video unless the host allows everything', () => {
    expect(videoStatusFor({ isGuestUpload: true, moderationMode: undefined })).toBe('held');
    expect(videoStatusFor({ isGuestUpload: true, moderationMode: 'review' })).toBe('held');
    expect(videoStatusFor({ isGuestUpload: true, moderationMode: 'allow_all' })).toBe('released');
  });

  it('releases the host\'s own video, there being nobody to approve it', () => {
    expect(videoStatusFor({ isGuestUpload: false, moderationMode: 'review' })).toBe('released');
  });

  it('shows a held video to no gallery reader, and a released one to everyone', () => {
    const ctx = { identity: null, audience: 'everyone' as const, callerId: '', privileged: false, shared: null };
    const held = { id: 'v', s3Key: 'events/e/photos/a.mp4', moderationStatus: 'held' };
    expect(listVis.photoVisibleTo(held, ctx)).toBe(false);
    expect(listVis.photoVisibleTo(held, { ...ctx, privileged: true })).toBe(false);
    expect(listVis.photoVisibleTo({ ...held, moderationStatus: 'released' }, ctx)).toBe(true);
    // A video from before review existed has no verdict and stays host-only.
    expect(listVis.photoVisibleTo({ ...held, moderationStatus: 'skipped' }, ctx)).toBe(false);
  });
});

describe('what a host may save', () => {
  const ok = (request: SettingsRequest) => {
    const result = buildPatch(request, { photoCount: 0 });
    if (!result.ok) throw new Error(result.reason);
    return result.patch;
  };

  it('stores the view switch and the pause switch', () => {
    expect(ok({ guestViewBlocked: true }).set).toMatchObject({ guestViewBlocked: true });
    expect(ok({ sharingPaused: true }).set).toMatchObject({ sharingPaused: true });
    expect(ok({ sharingPaused: false }).set).toMatchObject({ sharingPaused: false });
  });

  it('leaves everything alone when the fields are null', () => {
    const patch = ok({ guestViewBlocked: null, sharingPaused: null, name: 'Renamed' });
    expect(Object.keys(patch.set)).toEqual(['name']);
    expect(patch.remove).toEqual([]);
  });

  it('has no way to write the link key facts from the settings call', () => {
    const result = buildPatch(
      { galleryLinkSet: false, linkRotatedAt: '2000-01-01', linkKey: 'x' } as unknown as SettingsRequest,
      { photoCount: 0 },
    );
    expect(result.ok && Object.keys(result.patch.set)).not.toEqual(
      expect.arrayContaining(['galleryLinkSet', 'linkRotatedAt', 'linkKey']),
    );
  });
});

describe('copies that must not drift', () => {
  it('keeps galleryGate.ts identical in all four functions', () => {
    const copies = ['gallery-access', 'media-url', 'list-event-photos', 'booth-gallery'].map((dir) =>
      read(`amplify/functions/${dir}/galleryGate.ts`),
    );
    for (const copy of copies) expect(copy).toBe(copies[0]);
  });

  it('keeps visibility.ts identical in list-event-photos and media-url', () => {
    expect(read('amplify/functions/media-url/visibility.ts')).toBe(
      read('amplify/functions/list-event-photos/visibility.ts'),
    );
  });

  it('keeps the browser mirror of the key pattern equal to the server\'s', () => {
    expect(client.LINK_KEY_PATTERN.source).toBe(gate.LINK_KEY_PATTERN.source);
    for (const key of [newLinkKey(), newLinkKey(), 'short', '']) {
      expect(client.isValidLinkKey(key)).toBe(gate.isValidLinkKey(key));
    }
  });

  it('keeps the error strings the client matches equal to the ones the function throws', () => {
    const list = read('amplify/functions/list-event-photos/handler.ts');
    expect(list).toContain(`Error('${client.SHARING_PAUSED_MESSAGE}')`);
    expect(list).toContain(`Error('${client.LINK_REQUIRED_MESSAGE}')`);
  });
});

describe('the link key is never kept where a guest can read it', () => {
  const data = read('amplify/data/resource.ts');
  const start = data.indexOf('GalleryLink: a');
  const model = data.slice(start, start + 1200);

  it('lives in an admin-only model', () => {
    expect(start).toBeGreaterThan(-1);
    expect(model).toMatch(/allow\.group\('ADMINS'\)/);
    expect(model).not.toMatch(/allow\.(guest|publicApiKey|authenticated|owner)/);
  });

  it('is not a field on the Event model', () => {
    const event = data.slice(data.indexOf('Event: a'), data.indexOf('Photo: a'));
    expect(event).not.toMatch(/linkKey/);
  });

  it('puts only yes/no and a time on the Event, for guests to read', () => {
    expect(data).toContain('galleryLinkSet');
    expect(data).toContain('linkRotatedAt');
    expect(data).toContain('sharingPaused');
  });

  it('leaves no PIN behind', () => {
    for (const file of ['amplify/data/resource.ts', 'amplify/backend.ts', 'lib/galleryAccess.ts', 'lib/api.ts']) {
      expect(read(file)).not.toMatch(/GalleryPin|verifyGalleryPin|galleryPin|#pin=/);
    }
  });
});

describe('the server enforces pause and rotation, not just the page', () => {
  it('has list-event-photos and media-url both refuse through the shared gate', () => {
    for (const fn of ['list-event-photos', 'media-url']) {
      const handler = read(`amplify/functions/${fn}/handler.ts`);
      expect(handler).toContain('galleryGateFor');
      expect(handler).toContain('shareIsCurrent');
      expect(handler).toContain('linkKeyMatches');
    }
  });

  it('only lets the host or an admin read or replace the key', () => {
    const handler = read('amplify/functions/gallery-access/handler.ts');
    expect(handler).toMatch(/mayManage/);
    expect(read('amplify/data/resource.ts')).toMatch(/manageGalleryLink[\s\S]{0,600}allow\.authenticated\(\)/);
  });
});
