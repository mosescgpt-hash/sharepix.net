/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const manageGalleryLink = jest.fn();
const setEventSharingPaused = jest.fn();
const setEventGuestDownloadsBlocked = jest.fn();
const setEventGuestViewBlocked = jest.fn();
jest.mock('@/lib/api', () => ({
  manageGalleryLink: (...a: unknown[]) => manageGalleryLink(...a),
  setEventSharingPaused: (...a: unknown[]) => setEventSharingPaused(...a),
  setEventGuestDownloadsBlocked: (...a: unknown[]) => setEventGuestDownloadsBlocked(...a),
  setEventGuestViewBlocked: (...a: unknown[]) => setEventGuestViewBlocked(...a),
}));
jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg aria-label="Guest QR code" data-value={value} />,
}));

import GalleryAccessSettings from '@/components/GalleryAccessSettings';
import GalleryAccessNotice from '@/components/GalleryAccessNotice';
import {
  captureLinkKey,
  forgetLinkKey,
  getLinkKey,
  guestLinkPath,
  isLinkRequiredError,
  isSharingPausedError,
  linkKeyFromFragment,
  rememberLinkKey,
  resetLinkKeys,
} from '@/lib/galleryAccess';
import type { QREvent } from '@/lib/types';

const EVENT = { id: 'e1', name: 'Wedding', eventCode: 'ABC', tier: 'free', date: '2026-06-01' } as QREvent;
const KEY = 'AbCdEfGhIjKlMnOpQrStUv';
const KEY2 = 'ZyXwVuTsRqPoNmLkJiHgFe';

beforeEach(() => {
  jest.clearAllMocks();
  resetLinkKeys();
  window.sessionStorage.clear();
  manageGalleryLink.mockResolvedValue({ ok: true, message: '', linkKey: KEY, rotatedAt: '2026-06-02T00:00:00.000Z' });
  setEventSharingPaused.mockResolvedValue(undefined);
  setEventGuestDownloadsBlocked.mockResolvedValue(undefined);
  setEventGuestViewBlocked.mockResolvedValue(undefined);
});

describe('guest links', () => {
  it('puts the key in the fragment, never the query', () => {
    expect(guestLinkPath('e 1', KEY)).toBe(`/event/e%201/upload#k=${KEY}`);
    expect(guestLinkPath('e1', KEY, 'live')).toBe(`/event/e1/live#k=${KEY}`);
    expect(guestLinkPath('e1', KEY, 'gallery')).toBe(`/event/e1#k=${KEY}`);
    expect(guestLinkPath('e1', KEY)).not.toContain('?');
  });

  it('makes a plain link when there is no usable key', () => {
    expect(guestLinkPath('e1', null)).toBe('/event/e1/upload');
    expect(guestLinkPath('e1', '', 'gallery')).toBe('/event/e1');
    expect(guestLinkPath('e1', 'short', 'live')).toBe('/event/e1/live');
  });

  it('reads the key back from a fragment, and only a well-formed one', () => {
    expect(linkKeyFromFragment(`#k=${KEY}`)).toBe(KEY);
    expect(linkKeyFromFragment(`#a=b&k=${KEY}`)).toBe(KEY);
    for (const bad of ['', '#k=short', `#k=${KEY}x`, '#k=', `#key=${KEY}`, null, undefined]) {
      expect(linkKeyFromFragment(bad)).toBeNull();
    }
  });

  it('recognises the two errors the server uses', () => {
    expect(isSharingPausedError(new Error('SHARING_PAUSED'))).toBe(true);
    expect(isLinkRequiredError(new Error('LINK_REQUIRED'))).toBe(true);
    expect(isSharingPausedError(new Error('LINK_REQUIRED'))).toBe(false);
    expect(isLinkRequiredError('nope')).toBe(false);
  });
});

describe('the key held for a tab', () => {
  it('keeps the key it arrived with, per event', () => {
    expect(captureLinkKey('e1', `#k=${KEY}`)).toBe(KEY);
    expect(getLinkKey('e1')).toBe(KEY);
    expect(getLinkKey('other')).toBe('');
  });

  it('survives a reload through session storage', () => {
    rememberLinkKey('e1', KEY);
    resetLinkKeys();
    expect(getLinkKey('e1')).toBe(KEY);
  });

  it('replaces an old key with the new one, and forgets on request', () => {
    captureLinkKey('e1', `#k=${KEY}`);
    captureLinkKey('e1', `#k=${KEY2}`);
    expect(getLinkKey('e1')).toBe(KEY2);
    forgetLinkKey('e1');
    expect(getLinkKey('e1')).toBe('');
  });

  it('refuses to store a malformed key', () => {
    rememberLinkKey('e1', 'nope');
    expect(getLinkKey('e1')).toBe('');
  });
});

describe('GalleryAccessNotice', () => {
  it('says sharing is paused and that adding photos still works', () => {
    render(<GalleryAccessNotice reason="paused" />);
    expect(screen.getByRole('status')).toHaveTextContent('Sharing is paused');
    expect(screen.getByRole('status')).toHaveTextContent('adding photos still works');
  });

  it('says the link was replaced, for the slideshow too', () => {
    render(<GalleryAccessNotice reason="replaced" what="the slideshow" dark />);
    expect(screen.getByRole('status')).toHaveTextContent('This link was replaced');
    expect(screen.getByRole('status')).toHaveTextContent('the slideshow');
  });
});

describe('GalleryAccessSettings', () => {
  const setup = (event: Partial<QREvent> = {}) => {
    const onChange = jest.fn();
    render(<GalleryAccessSettings event={{ ...EVENT, ...event }} onChange={onChange} />);
    return { onChange };
  };

  it('explains pause and replace in a short note', () => {
    setup();
    const note = document.getElementById('gallery-access-note');
    expect(note).toHaveTextContent('Pause sharing');
    expect(note).toHaveTextContent('Replace QR code');
    expect(note).toHaveTextContent('reprint');
    expect((note?.textContent ?? '').length).toBeLessThan(450);
  });

  it('turns viewing off and saves it at once', async () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('switch', { name: /^Guests can view/ }));
    await waitFor(() => expect(setEventGuestViewBlocked).toHaveBeenCalledWith('e1', true));
    expect(onChange).toHaveBeenCalledWith({ guestViewBlocked: true });
  });

  it('turns downloads off and saves it at once', async () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('switch', { name: /^Guests can download/ }));
    await waitFor(() => expect(setEventGuestDownloadsBlocked).toHaveBeenCalledWith('e1', true));
    expect(onChange).toHaveBeenCalledWith({ guestDownloadsBlocked: true });
  });

  it('pauses sharing at once and says guests can still add photos', async () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('switch', { name: /pause sharing/i }));
    await waitFor(() => expect(setEventSharingPaused).toHaveBeenCalledWith('e1', true));
    expect(onChange).toHaveBeenCalledWith({ sharingPaused: true });
    expect(await screen.findByText(/Guests can add photos but cannot view or download/)).toBeInTheDocument();
  });

  it('resumes sharing from the paused state', async () => {
    const { onChange } = setup({ sharingPaused: true });
    const toggle = screen.getByRole('switch', { name: /pause sharing/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    await waitFor(() => expect(setEventSharingPaused).toHaveBeenCalledWith('e1', false));
    expect(onChange).toHaveBeenCalledWith({ sharingPaused: false });
  });

  it('shows the failure and keeps the old setting when a save fails', async () => {
    setEventSharingPaused.mockRejectedValue(new Error('The pause could not be saved.'));
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('switch', { name: /pause sharing/i }));
    expect(await screen.findByText('The pause could not be saved.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('warns about reprinting and does nothing until the host confirms', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Replace QR code' }));
    expect(manageGalleryLink).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/reprint/i);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(manageGalleryLink).not.toHaveBeenCalled();
  });

  it('replaces the QR code on confirm and shows the new code and links with the key in the fragment', async () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Replace QR code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, replace it' }));
    await waitFor(() => expect(manageGalleryLink).toHaveBeenCalledWith('e1', 'rotate'));
    expect(onChange).toHaveBeenCalledWith({ galleryLinkSet: true, linkRotatedAt: '2026-06-02T00:00:00.000Z' });
    const qr = await screen.findByLabelText('Guest QR code');
    expect(qr.getAttribute('data-value')).toMatch(new RegExp(`/event/e1/upload#k=${KEY}$`));
    expect(screen.getByRole('alert')).toHaveTextContent(/Reprint your signs/);
    expect((screen.getByLabelText('Gallery link') as HTMLInputElement).value).toMatch(new RegExp(`/event/e1#k=${KEY}$`));
    expect((screen.getByLabelText('Slideshow screen link') as HTMLInputElement).value).toMatch(
      new RegExp(`/event/e1/live#k=${KEY}$`),
    );
  });

  it('shows no new code when the replacement fails', async () => {
    manageGalleryLink.mockResolvedValue({ ok: false, message: 'Only the host can do that.' });
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Replace QR code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, replace it' }));
    expect(await screen.findByText('Only the host can do that.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Guest QR code')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers to show the current code once one has been made', async () => {
    setup({ galleryLinkSet: true });
    expect(screen.getByText(/has been replaced/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show current QR code and links' }));
    await waitFor(() => expect(manageGalleryLink).toHaveBeenCalledWith('e1', 'get'));
    expect(await screen.findByLabelText('Guest QR code')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('has no PIN controls', () => {
    setup();
    expect(screen.queryByText(/PIN/)).not.toBeInTheDocument();
  });

  it('keeps every control at least 44px tall', () => {
    setup({ galleryLinkSet: true });
    fireEvent.click(screen.getByRole('button', { name: 'Replace QR code' }));
    const controls = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('switch'),
      ...document.querySelectorAll('input'),
    ];
    const short = controls.filter((el) => !/min-h-\[44px\]/.test(el.className) && !el.closest('[class*="min-h-[44px]"]'));
    expect(short.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });
});
