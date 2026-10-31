/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';
const manageGalleryLink = jest.fn();
jest.mock('@/lib/api', () => ({ manageGalleryLink: (...a: unknown[]) => manageGalleryLink(...a) }));
jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg aria-label="Live link QR code" data-value={value} />,
}));

import ShareLiveLink from '@/components/ShareLiveLink';
import { resetLinkKeys } from '@/lib/galleryAccess';

beforeEach(() => {
  jest.clearAllMocks();
  resetLinkKeys();
  window.sessionStorage.clear();
  manageGalleryLink.mockResolvedValue({ ok: true, message: '', linkKey: KEY });
});

describe('ShareLiveLink', () => {
  it('offers Open live slideshow and Share live link up front', () => {
    render(<ShareLiveLink eventId="e1" eventName="Night of the Horse" />);
    const open = screen.getByRole('link', { name: 'Open live slideshow' });
    expect(open.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('button', { name: 'Share live link' })).toBeTruthy();
    expect(screen.queryByTestId('share-live-panel')).toBeNull();
  });

  it('shows the link with the current key, a QR code and copy', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ShareLiveLink eventId="e1" eventName="Night of the Horse" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share live link' }));
    const expected = `${window.location.origin}/event/e1/live#k=${KEY}`;
    await waitFor(() => expect((screen.getByLabelText('Live slideshow link') as HTMLInputElement).value).toBe(expected));
    expect(screen.getByLabelText('Live link QR code').getAttribute('data-value')).toBe(expected);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    await screen.findByRole('button', { name: 'Copied' });
    expect(screen.getByRole('link', { name: 'Email it to myself' }).getAttribute('href')).toContain('mailto:');
  });

  it('uses the plain link when the QR code was never replaced', async () => {
    manageGalleryLink.mockResolvedValue({ ok: true, message: '', linkKey: '' });
    render(<ShareLiveLink eventId="e1" eventName="E" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share live link' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Live slideshow link') as HTMLInputElement).value).toBe(
        `${window.location.origin}/event/e1/live`,
      ),
    );
  });

  it('says so when the clipboard is blocked', async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('no')) } });
    render(<ShareLiveLink eventId="e1" eventName="E" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share live link' }));
    await waitFor(() => expect((screen.getByLabelText('Live slideshow link') as HTMLInputElement).value).toContain('/live'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await screen.findByText(/Could not copy automatically/);
  });

  it('shows Share… only where the browser has native share', async () => {
    Object.assign(navigator, { share: jest.fn().mockResolvedValue(undefined) });
    render(<ShareLiveLink eventId="e1" eventName="E" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share live link' }));
    await screen.findByRole('button', { name: 'Share…' });
    delete (navigator as unknown as { share?: unknown }).share;
  });
});
