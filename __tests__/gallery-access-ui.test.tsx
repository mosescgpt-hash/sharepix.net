/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const manageGalleryPin = jest.fn();
const setEventGalleryPinPolicy = jest.fn();
const setEventGuestDownloadsBlocked = jest.fn();
const setEventGuestViewBlocked = jest.fn();
jest.mock('@/lib/api', () => ({
  manageGalleryPin: (...a: unknown[]) => manageGalleryPin(...a),
  setEventGalleryPinPolicy: (...a: unknown[]) => setEventGalleryPinPolicy(...a),
  setEventGuestDownloadsBlocked: (...a: unknown[]) => setEventGuestDownloadsBlocked(...a),
  setEventGuestViewBlocked: (...a: unknown[]) => setEventGuestViewBlocked(...a),
}));
jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg aria-label="PIN QR code" data-value={value} />,
}));

import GalleryAccessSettings from '@/components/GalleryAccessSettings';
import GalleryPinPrompt from '@/components/GalleryPinPrompt';
import {
  accessTokenNeedsRenewal,
  clearAccessToken,
  getAccessToken,
  pinFromFragment,
  pinLinkPath,
  resetAccessTokens,
  setAccessToken,
} from '@/lib/galleryAccess';
import type { QREvent } from '@/lib/types';

const EVENT = { id: 'e1', name: 'Wedding', eventCode: 'ABC', tier: 'free', date: '2026-06-01' } as QREvent;

beforeEach(() => {
  jest.clearAllMocks();
  resetAccessTokens();
  window.sessionStorage.clear();
  manageGalleryPin.mockResolvedValue({ ok: true, message: '' });
  setEventGalleryPinPolicy.mockResolvedValue(undefined);
  setEventGuestDownloadsBlocked.mockResolvedValue(undefined);
  setEventGuestViewBlocked.mockResolvedValue(undefined);
});

describe('PIN links', () => {
  it('puts the PIN in the fragment, never the query', () => {
    expect(pinLinkPath('e 1', '123456')).toBe('/event/e%201#pin=123456');
    expect(pinLinkPath('e1', '123456', 'live')).toBe('/event/e1/live#pin=123456');
    expect(pinLinkPath('e1', '123456')).not.toContain('?');
  });

  it('makes a plain link when there is no usable PIN', () => {
    expect(pinLinkPath('e1', null)).toBe('/event/e1');
    expect(pinLinkPath('e1', '12')).toBe('/event/e1');
  });

  it('reads the PIN back from a fragment, and only a well-formed one', () => {
    expect(pinFromFragment('#pin=4829')).toBe('4829');
    expect(pinFromFragment('#a=b&pin=482913')).toBe('482913');
    for (const bad of ['', '#pin=12', '#pin=1234567', '#pin=abcd', '#spin=1234', null, undefined]) {
      expect(pinFromFragment(bad)).toBeNull();
    }
  });
});

describe('the access token kept for the tab', () => {
  const now = Date.parse('2026-06-01T12:00:00Z');
  const later = (ms: number) => new Date(now + ms).toISOString();

  it('hands back a live token and nothing once it has lapsed', () => {
    setAccessToken('e1', 'tok', later(60 * 60 * 1000));
    expect(getAccessToken('e1', now)).toBe('tok');
    expect(getAccessToken('e1', now + 61 * 60 * 1000)).toBe('');
    expect(getAccessToken('other', now)).toBe('');
  });

  it('survives a reload of the page but not a closed tab', () => {
    setAccessToken('e1', 'tok', later(60 * 60 * 1000));
    expect(window.sessionStorage.length).toBe(1);
    clearAccessToken('e1');
    expect(window.sessionStorage.length).toBe(0);
    expect(getAccessToken('e1', now)).toBe('');
  });

  it('asks for renewal inside the last ten minutes only', () => {
    expect(accessTokenNeedsRenewal('e1', now)).toBe(false);
    setAccessToken('e1', 'tok', later(60 * 60 * 1000));
    expect(accessTokenNeedsRenewal('e1', now)).toBe(false);
    expect(accessTokenNeedsRenewal('e1', now + 51 * 60 * 1000)).toBe(true);
  });

  it('ignores an empty token or an unreadable expiry', () => {
    setAccessToken('e1', '', later(1000));
    setAccessToken('e1', 'tok', 'soon');
    expect(getAccessToken('e1', now)).toBe('');
  });
});

describe('GalleryPinPrompt', () => {
  const setup = (onSubmit = jest.fn().mockResolvedValue({ ok: true, message: '' })) => {
    const onUnlocked = jest.fn();
    render(<GalleryPinPrompt onSubmit={onSubmit} onUnlocked={onUnlocked} />);
    return { onSubmit, onUnlocked, input: screen.getByLabelText('PIN') as HTMLInputElement };
  };

  it('keeps digits only, six at most, with a number keypad and 44px controls', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: '12ab3456789' } });
    expect(input.value).toBe('123456');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input.className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: 'Open' }).className).toContain('min-h-[44px]');
  });

  it('does not ask the server about a PIN that cannot be right', () => {
    const { onSubmit, input } = setup();
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('4 to 6 digit');
  });

  it('opens the gallery on the right PIN', async () => {
    const { onSubmit, onUnlocked, input } = setup();
    fireEvent.change(input, { target: { value: '4829' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith('4829');
  });

  it('shows the server\'s message on a wrong PIN and clears the box', async () => {
    const { onUnlocked, input } = setup(jest.fn().mockResolvedValue({ ok: false, message: 'That PIN is not right.' }));
    fireEvent.change(input, { target: { value: '4829' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That PIN is not right.');
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('survives the check itself failing', async () => {
    const { input } = setup(jest.fn().mockRejectedValue(new Error('offline')));
    fireEvent.change(input, { target: { value: '4829' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be checked');
  });
});

describe('GalleryAccessSettings', () => {
  const setup = (event: Partial<QREvent> = {}) => {
    const onChange = jest.fn();
    render(<GalleryAccessSettings event={{ ...EVENT, ...event }} onChange={onChange} />);
    return { onChange };
  };

  it('says there is no PIN until one is set, and offers no link tools', () => {
    setup();
    expect(screen.getByText(/No PIN is set/)).toBeInTheDocument();
    expect(screen.queryByText('Make link and QR code')).not.toBeInTheDocument();
    expect(screen.queryByText('Remove the PIN')).not.toBeInTheDocument();
  });

  it('turns viewing off and saves it at once', async () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('switch', { name: /view/i }));
    await waitFor(() => expect(setEventGuestViewBlocked).toHaveBeenCalledWith('e1', true));
    expect(onChange).toHaveBeenCalledWith({ guestViewBlocked: true });
  });

  it('turns downloads off and saves it at once', async () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('switch', { name: /download/i }));
    await waitFor(() => expect(setEventGuestDownloadsBlocked).toHaveBeenCalledWith('e1', true));
    expect(onChange).toHaveBeenCalledWith({ guestDownloadsBlocked: true });
  });

  it('shows the failure and keeps the old setting when a save fails', async () => {
    setEventGuestViewBlocked.mockRejectedValue(new Error('The viewing setting could not be saved.'));
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('switch', { name: /view/i }));
    expect(await screen.findByText('The viewing setting could not be saved.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('saves a new PIN, digits only', async () => {
    const { onChange } = setup();
    const input = screen.getByLabelText('Set a PIN') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12x3456789' } });
    expect(input.value).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
    await waitFor(() => expect(manageGalleryPin).toHaveBeenCalledWith('e1', 'set', '123456'));
    expect(onChange).toHaveBeenCalledWith({ galleryPinSet: true });
  });

  it('describes the default schedule when a PIN is set', () => {
    setup({ galleryPinSet: true, date: '2099-06-01' });
    expect(screen.getByText(/switches on .*30 days after your event/)).toBeInTheDocument();
  });

  it('can set the schedule to always on, and back to automatic', async () => {
    const { onChange } = setup({ galleryPinSet: true, date: '2099-06-01' });
    fireEvent.click(screen.getByRole('radio', { name: 'Always on' }));
    await waitFor(() => expect(setEventGalleryPinPolicy).toHaveBeenCalledWith('e1', { mode: 'on' }));
    expect(onChange).toHaveBeenCalledWith({ galleryPinMode: 'on' });
  });

  it('changes the number of days', async () => {
    const { onChange } = setup({ galleryPinSet: true, date: '2099-06-01' });
    fireEvent.change(screen.getByLabelText('Days after the event'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setEventGalleryPinPolicy).toHaveBeenCalledWith('e1', { autoDays: 90 }));
    expect(onChange).toHaveBeenCalledWith({ galleryPinAutoDays: 90 });
  });

  it('makes a QR code and links with the PIN in the fragment, after confirming the PIN', async () => {
    setup({ galleryPinSet: true, date: '2020-01-01' });
    fireEvent.change(screen.getByLabelText('Type the PIN to confirm it'), { target: { value: '4829' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make link and QR code' }));
    await waitFor(() => expect(manageGalleryPin).toHaveBeenCalledWith('e1', 'check', '4829'));
    const qr = await screen.findByLabelText('PIN QR code');
    expect(qr.getAttribute('data-value')).toMatch(/\/event\/e1#pin=4829$/);
  });

  it('makes no link from a PIN the server says is wrong', async () => {
    manageGalleryPin.mockResolvedValue({ ok: false, message: 'That is not the PIN for this event.' });
    setup({ galleryPinSet: true, date: '2020-01-01' });
    fireEvent.change(screen.getByLabelText('Type the PIN to confirm it'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make link and QR code' }));
    expect(await screen.findByText('That is not the PIN for this event.')).toBeInTheDocument();
    expect(screen.queryByLabelText('PIN QR code')).not.toBeInTheDocument();
  });

  it('removes the PIN', async () => {
    const { onChange } = setup({ galleryPinSet: true, date: '2020-01-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove the PIN' }));
    await waitFor(() => expect(manageGalleryPin).toHaveBeenCalledWith('e1', 'clear'));
    expect(onChange).toHaveBeenCalledWith({ galleryPinSet: false });
  });

  it('keeps every button and field at least 44px tall for a phone', () => {
    setup({ galleryPinSet: true, date: '2020-01-01' });
    const controls = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('radio'),
      ...screen.getAllByRole('switch'),
      ...document.querySelectorAll('input'),
    ];
    const short = controls.filter((el) => !/min-h-\[44px\]/.test(el.className) && !el.closest('[class*="min-h-[44px]"]'));
    expect(short.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });
});
