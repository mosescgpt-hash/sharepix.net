/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const view = {
  ok: true,
  message: '',
  eventCode: 'SPK1.e.-.x',
  stopCode: 'SPK1.s.-.y',
  categories: [{ id: 'AAAAAAAA', name: 'Saturday', code: 'SPK1.c.AAAAAAAA.z' }],
  uploadsClosed: false,
  uploadsClosedBy: null,
};
const boothCodes = jest.fn((input: { action: string }) =>
  Promise.resolve(
    input.action === 'close'
      ? { ...view, uploadsClosed: true, uploadsClosedBy: 'host', message: 'Guest uploads are closed.' }
      : input.action === 'add'
        ? { ...view, categories: [...view.categories, { id: 'BBBBBBBB', name: 'Sunday', code: 'c2' }], message: 'Added Sunday.' }
        : view,
  ),
);
const uploadBoothGuestPhoto = jest.fn();
jest.mock('@/lib/api', () => ({
  boothCodes: (i: { action: string }) => boothCodes(i),
  uploadBoothGuestPhoto: (...a: unknown[]) => (uploadBoothGuestPhoto as (...x: unknown[]) => unknown)(...a),
}));
jest.mock('qrcode.react', () => ({
  QRCodeSVG: (p: { value: string; 'aria-label': string }) => <svg aria-label={p['aria-label']} data-value={p.value} />,
}));

import BoothCodes from '@/components/BoothCodes';
import BoothGuestUpload from '@/components/BoothGuestUpload';

describe('Start & stop codes section', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows each code with a clear label, and adds a category', async () => {
    const onCategories = jest.fn();
    render(<BoothCodes eventId="e1" onCategories={onCategories} />);
    expect(await screen.findByLabelText('Event start QR code')).toBeTruthy();
    expect(screen.getByLabelText('Stop QR code')).toBeTruthy();
    expect(screen.getByLabelText('Start: Saturday QR code')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Print' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(3);
    fireEvent.change(screen.getByPlaceholderText(/Saturday, or Morning/), { target: { value: 'Sunday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    expect(await screen.findByLabelText('Start: Sunday QR code')).toBeTruthy();
    expect(boothCodes).toHaveBeenCalledWith({ eventId: 'e1', action: 'add', name: 'Sunday' });
    expect(onCategories).toHaveBeenLastCalledWith(expect.arrayContaining([{ id: 'BBBBBBBB', name: 'Sunday', code: 'c2' }]));
  });

  it('puts a sharepix.net link in every code, never a raw string a phone camera would just print', async () => {
    render(<BoothCodes eventId="e1" />);
    const start = await screen.findByLabelText('Event start QR code');
    expect(start.getAttribute('data-value')).toBe('https://www.sharepix.net/b/e1/SPK1.e.-.x');
    expect(screen.getByLabelText('Stop QR code').getAttribute('data-value')).toBe('https://www.sharepix.net/b/e1/SPK1.s.-.y');
    expect(screen.getByLabelText('Start: Saturday QR code').getAttribute('data-value')).toBe(
      'https://www.sharepix.net/b/e1/SPK1.c.AAAAAAAA.z',
    );
  });

  it('says guests do not need these codes', async () => {
    render(<BoothCodes eventId="e1" />);
    await screen.findByLabelText('Stop QR code');
    expect(screen.getAllByText(/Guests do not need these/).length).toBeGreaterThan(0);
  });

  it('closes guest uploads', async () => {
    render(<BoothCodes eventId="e1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close uploads / Stop event' }));
    expect(await screen.findByRole('button', { name: 'Reopen uploads' })).toBeTruthy();
    expect(boothCodes).toHaveBeenCalledWith({ eventId: 'e1', action: 'close' });
  });
});

describe('guest uploads on the photo page', () => {
  it('shows the friendly message once uploads are closed', () => {
    render(
      <BoothGuestUpload galleryKey="k" open={false} message="Uploads for this event are closed. Thanks for sharing!" left={0} />,
    );
    expect(screen.getByText('Uploads for this event are closed. Thanks for sharing!')).toBeTruthy();
    expect(screen.queryByText('Choose photos')).toBeNull();
  });

  it('offers the picker while open', async () => {
    render(<BoothGuestUpload galleryKey="k" open message={null} left={50} />);
    await waitFor(() => expect(screen.getByText('Choose photos')).toBeTruthy());
    expect(screen.getByText(/host checks each one/)).toBeTruthy();
  });
});
