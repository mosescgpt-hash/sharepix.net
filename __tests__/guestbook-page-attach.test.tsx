/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('next/router', () => ({ useRouter: () => ({ isReady: true, query: { eventId: 'e1' } }) }));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
jest.mock('@/components/Layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/GuestReferralLink', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/wakeLock', () => ({ keepScreenAwake: async () => ({ release: async () => {} }) }));

// The page and the upload hook are real; only the network edge is faked, so
// these tests exercise the actual single upload path.
const api = {
  fetchEvent: jest.fn(),
  fetchEventPhotos: jest.fn(),
  fetchGuestBook: jest.fn(),
  signGuestBook: jest.fn(),
  prepareEventUpload: jest.fn(),
  computeContentHash: jest.fn(),
  fetchEventPhotoHashIds: jest.fn(),
  uploadEventPhotoWithContext: jest.fn(),
};
jest.mock('@/lib/api', () => ({
  fetchEvent: (...a: unknown[]) => api.fetchEvent(...a),
  fetchEventPhotos: (...a: unknown[]) => api.fetchEventPhotos(...a),
  fetchGuestBook: (...a: unknown[]) => api.fetchGuestBook(...a),
  signGuestBook: (...a: unknown[]) => api.signGuestBook(...a),
  prepareEventUpload: (...a: unknown[]) => api.prepareEventUpload(...a),
  computeContentHash: (...a: unknown[]) => api.computeContentHash(...a),
  fetchEventPhotoHashIds: (...a: unknown[]) => api.fetchEventPhotoHashIds(...a),
  uploadEventPhotoWithContext: (...a: unknown[]) => api.uploadEventPhotoWithContext(...a),
}));

import GuestBookPage from '@/pages/event/[eventId]/guestbook';

const baseEvent = {
  id: 'e1',
  name: 'Gala',
  tier: 'plus',
  guestBookEnabled: true,
  videoUploadsEnabled: true,
  moderationMode: 'review',
  videoLimit: 10,
  videoCount: 0,
};

function photoFile(name = 'cake.jpg') {
  return new File(['abc'], name, { type: 'image/jpeg' });
}
function videoFile(name = 'hello.mp4') {
  return new File(['abc'], name, { type: 'video/mp4' });
}

async function openPage(eventOverrides: Record<string, unknown> = {}) {
  api.fetchEvent.mockResolvedValue({ ...baseEvent, ...eventOverrides });
  render(<GuestBookPage />);
  await screen.findByRole('button', { name: 'Sign the guest book' });
}

function fillName(value = 'Aunt May') {
  fireEvent.change(screen.getByLabelText(/your name/i), { target: { value } });
}
function pick(label: string, file: File) {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
}
function sign() {
  fireEvent.click(screen.getByRole('button', { name: 'Sign the guest book' }));
}

describe('guest book: attach a photo or video while signing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.fetchEventPhotos.mockResolvedValue([]);
    api.fetchGuestBook.mockResolvedValue([]);
    api.prepareEventUpload.mockResolvedValue({});
    api.computeContentHash.mockImplementation(async (f: File) => `hash-${f.name}`);
    api.fetchEventPhotoHashIds.mockResolvedValue(new Map());
    api.uploadEventPhotoWithContext.mockResolvedValue({ id: 'photo-1', duplicate: false });
    api.signGuestBook.mockResolvedValue({ id: 'entry-1', pending: false });
  });

  it('offers both buttons, with the right inputs, and the consent line', async () => {
    await openPage();
    const photo = screen.getByLabelText('Add a photo') as HTMLInputElement;
    const video = screen.getByLabelText('Record a video message') as HTMLInputElement;
    expect(photo.accept).toContain('image/*');
    expect(photo.hasAttribute('capture')).toBe(false); // phones offer camera and library
    expect(video.accept).toContain('video/*');
    expect(video.getAttribute('capture')).toBe('user');
    expect(screen.getByText(/By uploading, you understand these photos and videos will be visible to other event guests\./)).toBeTruthy();
    expect(screen.getByText(/Videos go to the host first/)).toBeTruthy();
  });

  it('hides the video button when the event does not take videos', async () => {
    await openPage({ videoUploadsEnabled: false });
    expect(screen.getByLabelText('Add a photo')).toBeTruthy();
    expect(screen.queryByLabelText('Record a video message')).toBeNull();
    expect(screen.queryByText(/Videos go to the host first/)).toBeNull();
  });

  it('hides the video button when no video slots are left', async () => {
    await openPage({ tier: 'legacy-test', guestBookEnabled: true, videoLimit: 2, videoCount: 2 });
    expect(screen.queryByLabelText('Record a video message')).toBeNull();
  });

  it('uploads on Sign under the guest book name, then signs with the photo id', async () => {
    await openPage();
    fillName('Aunt May');
    pick('Add a photo', photoFile());
    expect(api.uploadEventPhotoWithContext).not.toHaveBeenCalled(); // staged, not sent
    await waitFor(() => expect(api.prepareEventUpload).toHaveBeenCalled()); // session warm-up
    sign();
    await waitFor(() => expect(api.signGuestBook).toHaveBeenCalled());
    expect(api.prepareEventUpload).toHaveBeenLastCalledWith('e1', 'Aunt May', null, null);
    expect(api.uploadEventPhotoWithContext).toHaveBeenCalledTimes(1);
    expect(api.signGuestBook).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'e1', name: 'Aunt May', photoId: 'photo-1' }),
    );
    expect(await screen.findByText(/your note is in the book below/)).toBeTruthy();
  });

  it('tells the guest a video will show once the host approves it', async () => {
    await openPage();
    fillName();
    pick('Record a video message', videoFile());
    sign();
    expect(await screen.findByText(/Your video will show once the host approves it/)).toBeTruthy();
    expect(api.signGuestBook).toHaveBeenCalledWith(expect.objectContaining({ photoId: 'photo-1' }));
  });

  it('attaches the existing photo when the same file is already in the event', async () => {
    api.fetchEventPhotoHashIds.mockResolvedValue(new Map([['hash-cake.jpg', 'existing-9']]));
    await openPage();
    fillName();
    pick('Add a photo', photoFile());
    sign();
    await waitFor(() => expect(api.signGuestBook).toHaveBeenCalled());
    expect(api.uploadEventPhotoWithContext).not.toHaveBeenCalled();
    expect(api.signGuestBook).toHaveBeenCalledWith(expect.objectContaining({ photoId: 'existing-9' }));
  });

  it('attaches the existing photo when the server reports a duplicate', async () => {
    api.uploadEventPhotoWithContext.mockResolvedValue({ id: 'winner-3', duplicate: true });
    await openPage();
    fillName();
    pick('Add a photo', photoFile());
    sign();
    await waitFor(() => expect(api.signGuestBook).toHaveBeenCalled());
    expect(api.signGuestBook).toHaveBeenCalledWith(expect.objectContaining({ photoId: 'winner-3' }));
  });

  it('keeps the note and signs nothing when the upload fails, then retries the upload', async () => {
    api.uploadEventPhotoWithContext.mockRejectedValueOnce(new Error('Upload failed.'));
    await openPage();
    fillName();
    fireEvent.change(screen.getByLabelText(/your note/i), { target: { value: 'Congrats!' } });
    pick('Add a photo', photoFile());
    sign();
    expect(await screen.findByText(/Your note is still here/)).toBeTruthy();
    expect(api.signGuestBook).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/your note/i) as HTMLTextAreaElement).value).toBe('Congrats!');

    sign();
    await waitFor(() => expect(api.signGuestBook).toHaveBeenCalledTimes(1));
    expect(api.uploadEventPhotoWithContext).toHaveBeenCalledTimes(2);
    expect(api.signGuestBook).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Congrats!', photoId: 'photo-1' }),
    );
  });

  it('never uploads twice when only the note fails to save', async () => {
    api.signGuestBook.mockRejectedValueOnce(new Error('Too many notes.'));
    await openPage();
    fillName();
    pick('Add a photo', photoFile());
    sign();
    expect(await screen.findByText(/already uploaded and will not be sent again/)).toBeTruthy();
    expect(api.uploadEventPhotoWithContext).toHaveBeenCalledTimes(1);

    sign();
    await waitFor(() => expect(api.signGuestBook).toHaveBeenCalledTimes(2));
    expect(api.uploadEventPhotoWithContext).toHaveBeenCalledTimes(1);
    expect(api.prepareEventUpload).toHaveBeenCalledTimes(2); // warm-up + the one batch; no second batch
    expect(api.signGuestBook).toHaveBeenLastCalledWith(expect.objectContaining({ photoId: 'photo-1' }));
  });

  it('still signs a note with no attachment exactly as before', async () => {
    await openPage();
    fillName();
    fireEvent.change(screen.getByLabelText(/your note/i), { target: { value: 'Lovely day' } });
    sign();
    await waitFor(() => expect(api.signGuestBook).toHaveBeenCalled());
    expect(api.signGuestBook).toHaveBeenCalledWith({
      eventId: 'e1',
      name: 'Aunt May',
      message: 'Lovely day',
      photoId: null,
    });
    expect(api.uploadEventPhotoWithContext).not.toHaveBeenCalled();
    expect(api.prepareEventUpload).not.toHaveBeenCalled();
  });

  it('lets a guest remove the staged file before signing', async () => {
    await openPage();
    fillName();
    pick('Add a photo', photoFile());
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    sign();
    await waitFor(() => expect(api.signGuestBook).toHaveBeenCalled());
    expect(api.uploadEventPhotoWithContext).not.toHaveBeenCalled();
    expect(api.signGuestBook).toHaveBeenCalledWith(expect.objectContaining({ photoId: null }));
  });
});
