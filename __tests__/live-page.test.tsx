/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchEvent = jest.fn();
const fetchEventPhotoRecords = jest.fn();
const getCurrentUserInfo = jest.fn();
const getPhotoDisplaySource = jest.fn();
jest.mock('@/lib/api', () => ({
  fetchEvent: (...a: unknown[]) => fetchEvent(...a),
  fetchEventPhotoRecords: (...a: unknown[]) => fetchEventPhotoRecords(...a),
  getCurrentUserInfo: (...a: unknown[]) => getCurrentUserInfo(...a),
  getPhotoDisplaySource: (...a: unknown[]) => getPhotoDisplaySource(...a),
  manageGalleryLink: jest.fn().mockResolvedValue({ ok: true, message: '', linkKey: '' }),
  fetchEventChallenges: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/admin', () => ({ isGlobalAdmin: () => Promise.resolve(false) }));
jest.mock('next/router', () => ({ useRouter: () => ({ query: { eventId: 'e1' } }) }));
jest.mock('@/lib/authUser', () => ({ useAuthUser: () => ({ status: 'out' }) }));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg aria-label="QR" data-value={value} />,
}));

import LivePage from '@/pages/event/[eventId]/live';
import { resetLinkKeys } from '@/lib/galleryAccess';

const EVENT = { id: 'e1', name: 'Night of the Horse', tier: 'plus', liveSlideshowEnabled: true, date: '2026-10-30' };
const old = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  eventId: 'e1',
  s3Key: `events/e1/${id}.jpg`,
  uploadedBy: 'Zane',
  approved: true,
  createdAt: '2020-01-01T00:00:00.000Z',
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  resetLinkKeys();
  window.sessionStorage.clear();
  fetchEvent.mockResolvedValue(EVENT);
  getCurrentUserInfo.mockResolvedValue(null);
  getPhotoDisplaySource.mockResolvedValue({ primary: 'https://img.test/a.jpg' });
});

describe('live page on a phone', () => {
  it('fills the visible screen (fixed layer, dynamic viewport height) instead of 100vh', async () => {
    fetchEventPhotoRecords.mockResolvedValue([old('p1')]);
    const { container } = render(<LivePage />);
    await waitFor(() => expect(container.querySelector('main')).toBeTruthy());
    const main = container.querySelector('main') as HTMLElement;
    expect(main.className).toContain('fixed');
    expect(main.className).toContain('inset-0');
    expect(main.className).not.toContain('h-screen');
    expect(main.style.width).toBe('100vw');
  });

  it('shows exactly one photo at a time, never a grid', async () => {
    fetchEventPhotoRecords.mockResolvedValue([old('p1'), old('p2'), old('p3')]);
    const { container } = render(<LivePage />);
    await waitFor(() => expect(container.querySelectorAll('img').length).toBe(1), { timeout: 3000 });
    expect(container.querySelector('[class*="grid"]')).toBeNull();
  });

  it('locks page scroll while open and restores it after', async () => {
    fetchEventPhotoRecords.mockResolvedValue([old('p1')]);
    const { unmount } = render(<LivePage />);
    expect(document.documentElement.style.overflow).toBe('hidden');
    unmount();
    expect(document.documentElement.style.overflow).not.toBe('hidden');
  });

  it('has a Full screen button; where the browser has no fullscreen (iPhone) it fills the screen and explains', async () => {
    fetchEventPhotoRecords.mockResolvedValue([old('p1')]);
    render(<LivePage />);
    const button = await screen.findByRole('button', { name: 'Full screen' });
    fireEvent.click(button);
    await screen.findByText(/Add to Home Screen/);
    expect(await screen.findByRole('button', { name: 'Exit full screen' })).toBeTruthy();
    // Bottom bar is hidden in fill mode so only the photo shows.
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(await screen.findByRole('button', { name: 'Full screen' })).toBeTruthy();
  });

  it('uses the real fullscreen API when the browser has it', async () => {
    fetchEventPhotoRecords.mockResolvedValue([old('p1')]);
    const request = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    (document.documentElement as unknown as { requestFullscreen: unknown }).requestFullscreen = request;
    render(<LivePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Full screen' }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    Object.defineProperty(document, 'fullscreenEnabled', { value: undefined, configurable: true });
    delete (document.documentElement as unknown as { requestFullscreen?: unknown }).requestFullscreen;
  });
});

describe('live page robustness (a phone that sees nothing)', () => {
  it('says photos are in the review window rather than "waiting for photos"', async () => {
    fetchEventPhotoRecords.mockResolvedValue([old('p1', { createdAt: new Date().toISOString() })]);
    render(<LivePage />);
    await screen.findByText(/each one appears about 90 seconds/);
  });

  it('says when only videos exist', async () => {
    fetchEventPhotoRecords.mockResolvedValue([old('v1', { s3Key: 'events/e1/v1.mp4' })]);
    render(<LivePage />);
    await screen.findByText(/Only videos have been added/);
  });

  it('reports a failing start-up with a Try again button, and recovers', async () => {
    fetchEvent.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchEventPhotoRecords.mockResolvedValue([old('p1')]);
    const { container } = render(<LivePage />);
    await screen.findByText(/Having trouble reaching SharePix/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(container.querySelectorAll('img').length).toBe(1), { timeout: 3000 });
  });

  it('is not held on "Starting" by an admin check that never answers', async () => {
    jest.resetModules();
    fetchEventPhotoRecords.mockResolvedValue([old('p1')]);
    getCurrentUserInfo.mockReturnValue(new Promise(() => undefined));
    jest.useFakeTimers();
    const { container } = render(<LivePage />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(9_500);
    });
    expect(container.querySelectorAll('img').length).toBe(1);
    jest.useRealTimers();
  });

  it('tells the viewer when photos exist but none could be loaded', async () => {
    fetchEventPhotoRecords.mockResolvedValue([old('p1')]);
    getPhotoDisplaySource.mockRejectedValue(new Error('That file is not available.'));
    render(<LivePage />);
    await screen.findByText(/could not be loaded yet/, undefined, { timeout: 3000 });
  });
});
