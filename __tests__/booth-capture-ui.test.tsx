/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const uploadBoothGuestPhoto = jest.fn();
jest.mock('@/lib/api', () => ({
  uploadBoothGuestPhoto: (...a: unknown[]) => (uploadBoothGuestPhoto as (...x: unknown[]) => unknown)(...a),
}));
jest.mock('qrcode.react', () => ({
  QRCodeSVG: (p: { value: string; 'aria-label': string }) => <svg aria-label={p['aria-label']} data-value={p.value} />,
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import BoothCapture, { cameraProblem } from '@/components/BoothCapture';

const stop = jest.fn();
const getUserMedia = jest.fn();

function fakeCamera() {
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { value: null, writable: true, configurable: true });
  HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { value: 3000, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { value: 4000, configurable: true });
  HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({ drawImage: jest.fn() }) as never;
  HTMLCanvasElement.prototype.toDataURL = jest.fn().mockReturnValue('data:image/jpeg;base64,/9j/AAAA');
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => (cb(0), 0)) as never;
}

const props = {
  galleryKey: 'KEY123',
  eventName: 'Gala',
  attendeeName: 'Seth',
  uploadsOpen: true,
  uploadsMessage: null,
  sharedGalleryPath: '/event/e1',
  sharedGalleryMessage: null,
};

describe('booth capture: scan once, take photos until Stop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    uploadBoothGuestPhoto.mockResolvedValue({ ok: true, message: '' });
    fakeCamera();
  });

  it('opens the camera once and keeps it open for any number of photos', async () => {
    render(<BoothCapture {...props} />);
    expect(screen.getByRole('heading', { name: 'Seth, take photos' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    const shutter = await screen.findByRole('button', { name: 'Take photo' });
    for (let i = 0; i < 12; i += 1) fireEvent.click(shutter);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(screen.getByText(/12 photos taken/)).toBeTruthy();
    await waitFor(() => expect(uploadBoothGuestPhoto).toHaveBeenCalledTimes(12));
    expect(uploadBoothGuestPhoto).toHaveBeenCalledWith('KEY123', 'data:image/jpeg;base64,/9j/AAAA');
  });

  it('has a big Stop that ends the session and shows the personal QR', async () => {
    render(<BoothCapture {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    const shutter = await screen.findByRole('button', { name: 'Take photo' });
    fireEvent.click(shutter);
    fireEvent.click(shutter);
    const stopButton = screen.getByRole('button', { name: 'Stop' });
    expect(stopButton.className).toContain('min-h-[64px]');
    await act(async () => {
      fireEvent.click(stopButton);
    });
    expect(await screen.findByText('2 photos sent')).toBeTruthy();
    expect(stop).toHaveBeenCalled();
    const qr = screen.getByLabelText('Your personal photo page QR code');
    expect(qr.getAttribute('data-value')).toMatch(/\/booth\/photos\/KEY123$/);
    expect(screen.getByText('See my photos').getAttribute('href')).toBe('/booth/photos/KEY123');
    expect(screen.getByText(/shared gallery/).getAttribute('href')).toBe('/event/e1');
    expect(screen.getByRole('button', { name: 'Take more photos' })).toBeTruthy();
  });

  it('waits for the last uploads before showing the summary', async () => {
    let release: (v: { ok: boolean; message: string }) => void = () => undefined;
    uploadBoothGuestPhoto.mockImplementationOnce(() => new Promise((r) => (release = r)));
    render(<BoothCapture {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Take photo' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    });
    expect(screen.getByText(/Sending your last photos/)).toBeTruthy();
    await act(async () => release({ ok: true, message: '' }));
    expect(await screen.findByText('1 photo sent')).toBeTruthy();
  });

  it('explains a blocked camera and still offers the photo picker', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    render(<BoothCapture {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(await screen.findByText(/camera is blocked/i)).toBeTruthy();
    expect(screen.getByText('Choose photos')).toBeTruthy();
  });

  it('shows the host’s words, not a camera, when uploads are closed', () => {
    render(
      <BoothCapture {...props} uploadsOpen={false} uploadsMessage="Uploads for this event are closed. Thanks for sharing!" />,
    );
    expect(screen.getByText(/closed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start camera' })).toBeNull();
    expect(screen.getByText('See my photos')).toBeTruthy();
  });

  it('maps camera errors to plain advice', () => {
    expect(cameraProblem(Object.assign(new Error(), { name: 'NotAllowedError' }))).toMatch(/Settings|Permissions/);
    expect(cameraProblem(Object.assign(new Error(), { name: 'NotFoundError' }))).toMatch(/No camera/);
    expect(cameraProblem(new Error('x'))).toMatch(/could not start/);
  });
});
