import { readFileSync } from 'fs';
import { BOOTH_LINK_BASE, boothLink, boothPayloadOf, readBoothLink } from '../lib/boothLink';
import { boothQrPayload, tokenFromBoothQr } from '../lib/booth';
import { withBoothCategories } from '../lib/boothGalleryGroups';
import { guestUploadRefusal, startsEvent } from '../amplify/functions/booth-scan/boothControl';
import { publishesToGallery, statusAfterMove } from '../amplify/functions/booth-scan/boothPublish';
import { sharedGalleryFor } from '../amplify/functions/booth-gallery/sharedGallery';

const OFFLINE = 'SPB1.abc123.QUJDREVGRw';

describe('one booth code: the link', () => {
  it('round-trips online and offline payloads', () => {
    const online = boothLink('evt1', 'sharepix-booth:tok_ABC-123456789xyz');
    expect(online).toBe(`${BOOTH_LINK_BASE}evt1/t.tok_ABC-123456789xyz`);
    expect(readBoothLink(online)).toEqual({ eventId: 'evt1', payload: 'sharepix-booth:tok_ABC-123456789xyz' });
    expect(boothPayloadOf(online, 'evt1')).toBe('sharepix-booth:tok_ABC-123456789xyz');
    const off = boothLink('evt1', OFFLINE);
    expect(boothPayloadOf(off, 'evt1')).toBe(OFFLINE);
  });
  it('keeps old-format codes working', () => {
    expect(boothPayloadOf('sharepix-booth:tok', 'evt1')).toBe('sharepix-booth:tok');
    expect(boothPayloadOf(OFFLINE, 'evt1')).toBe(OFFLINE);
    expect(tokenFromBoothQr('sharepix-booth:tok_ABC-123456789xyz')).toBe('tok_ABC-123456789xyz');
    expect(tokenFromBoothQr(boothQrPayload('tok_ABC-123456789xyz', 'evt1'))).toBe('tok_ABC-123456789xyz');
  });
  it('refuses links for another event and non-booth URLs', () => {
    expect(boothPayloadOf(boothLink('other', OFFLINE), 'evt1')).toBeNull();
    expect(boothPayloadOf('https://example.com/b/evt1/x', 'evt1')).toBeNull();
    expect(readBoothLink('https://www.sharepix.net/event/evt1')).toBeNull();
  });
  it('keeps copies byte-identical', () => {
    const link = readFileSync('lib/boothLink.ts', 'utf8');
    for (const fn of ['process-pro-photo', 'booth-scan', 'booth-gallery']) {
      expect(readFileSync(`amplify/functions/${fn}/boothLink.ts`, 'utf8')).toBe(link);
    }
    expect(readFileSync('amplify/functions/decide-pro-photo/boothPublish.ts', 'utf8')).toBe(
      readFileSync('amplify/functions/booth-scan/boothPublish.ts', 'utf8'),
    );
    expect(readFileSync('amplify/functions/booth-gallery/boothSeal.ts', 'utf8')).toBe(
      readFileSync('amplify/functions/process-pro-photo/boothSeal.ts', 'utf8'),
    );
  });
});

describe('uploads open once the event has started', () => {
  it('allows an unscanned guest after the start', () => {
    expect(guestUploadRefusal({ sessionAt: null, eventStarted: false } as never)).toBe('not-scanned');
    expect(guestUploadRefusal({ sessionAt: null, eventStarted: true } as never)).not.toBe('not-scanned');
  });
  it('event and category codes start the event', () => {
    expect(startsEvent({ to: 'event' } as never)).toBe(true);
    expect(startsEvent({ to: 'category' } as never)).toBe(true);
    expect(startsEvent({ to: 'person' } as never)).toBe(false);
  });
});

describe('shared gallery publishing', () => {
  it('publishes only event and category photos', () => {
    expect(publishesToGallery({ segment: 'event', match: 'auto', divider: false })).toBe(true);
    expect(publishesToGallery({ segment: 'category', match: 'auto', divider: false })).toBe(true);
    expect(publishesToGallery({ segment: 'person', match: 'auto', divider: false })).toBe(false);
    expect(publishesToGallery({ segment: 'stopped', match: 'auto', divider: false })).toBe(false);
    expect(publishesToGallery({ segment: null, match: 'none', divider: false })).toBe(false);
    expect(publishesToGallery({ segment: 'event', match: 'divider', divider: true })).toBe(false);
  });
  it('moves change gallery status', () => {
    expect(statusAfterMove('approved', true)).toEqual({ publishStatus: 'published', approved: true });
    expect(statusAfterMove('published', false)).toEqual({ publishStatus: 'approved', approved: false });
    expect(statusAfterMove('pending', true)).toBeNull();
    expect(statusAfterMove('approved', false)).toBeNull();
  });
  it('respects gallery privacy', () => {
    expect(sharedGalleryFor({ eventId: 'e', audience: null, takenDown: false })).toEqual({
      sharedGalleryPath: '/event/e',
      sharedGalleryMessage: null,
    });
    expect(sharedGalleryFor({ eventId: 'e', audience: 'host', takenDown: false }).sharedGalleryPath).toBeNull();
    expect(sharedGalleryFor({ eventId: 'e', audience: 'own', takenDown: false }).sharedGalleryMessage).toMatch(/only the photos they added/);
    expect(sharedGalleryFor({ eventId: 'e', audience: null, takenDown: true })).toEqual({
      sharedGalleryPath: null,
      sharedGalleryMessage: null,
    });
  });
  it('groups booth categories after moments', () => {
    const { photos, moments } = withBoothCategories(
      [
        { id: '1', momentId: null, boothCategoryName: 'Dance' },
        { id: '2', momentId: 'm1', boothCategoryName: 'Dance' },
        { id: '3', momentId: null, boothCategoryName: null },
      ],
      [{ id: 'm1', name: 'Dinner', sortOrder: 2 }],
    );
    expect(moments.map((m) => m.name)).toEqual(['Dinner', 'Dance']);
    expect(photos[0].momentId).toBe('booth-category:Dance');
    expect(photos[1].momentId).toBe('m1');
    expect(photos[2].momentId).toBeNull();
  });
});

describe('booth functions read the field name the way Amplify sends it', () => {
  // Live, Amplify Gen2 sent no `info.fieldName` here: every boothGuestLink,
  // boothGuestUpload and boothStopEmails call fell through to the gallery.
  it.each(['booth-gallery', 'booth-deliveries'])('%s falls back to the top-level fieldName', (dir) => {
    const src = readFileSync(`amplify/functions/${dir}/handler.ts`, 'utf8');
    expect(src).toMatch(/info\?\.fieldName \?\? event\??\.fieldName/);
  });
  it('a /b/ code for no event says so in plain words, not the email wording', () => {
    const src = readFileSync('amplify/functions/booth-gallery/handler.ts', 'utf8');
    const fn = src.slice(src.indexOf('async function guestLink'));
    expect(fn).toContain('This code isn’t valid for any event. Ask the host for a new one.');
    expect(fn.slice(0, fn.indexOf('\n}\n'))).not.toContain('email it came in');
  });
});
