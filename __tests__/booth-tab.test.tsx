/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mockAttendees, mockStatus } from './helpers/boothMock';

const decideProPhoto = jest.fn(() => Promise.resolve());
const assignBoothPhotos = jest.fn(() => Promise.resolve({ ok: true, message: 'Moved.' }));
jest.mock('@/lib/api', () => ({
  listBoothAttendees: jest.fn(() => Promise.resolve(mockAttendees)),
  fetchBoothStatus: jest.fn(() => Promise.resolve(mockStatus())),
  decideProPhoto: (...a: unknown[]) => (decideProPhoto as (...x: unknown[]) => unknown)(...a),
  assignBoothPhotos: (...a: unknown[]) => (assignBoothPhotos as (...x: unknown[]) => unknown)(...a),
  processProPhoto: jest.fn(),
  requestProUploadSlot: jest.fn(),
  resendBoothEmail: jest.fn(),
  setEventBoothModeAsHost: jest.fn(() => Promise.resolve()),
}));
jest.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg aria-label="Sign-up QR code" /> }));

import BoothTab from '@/components/BoothTab';

async function renderTab() {
  render(<BoothTab eventId="e1" origin="https://www.sharepix.net" onTurnedOff={() => undefined} />);
  await screen.findByText('Approve all for Zeb');
}

describe('the Booth tab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lays booth mode out as five numbered steps', async () => {
    await renderTab();
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual([
      'Step 1: Sign people up',
      'Step 2: Who signed up (3)',
      'Step 3: Upload your photos',
      "Step 4: Check who's in each photo",
      'Step 5: Approve and send',
    ]);
    expect(screen.getByText('Open kiosk mode')).toHaveAttribute('href', 'https://www.sharepix.net/booth/e1?kiosk=1');
    expect(screen.getByText('Open the offline kiosk')).toBeInTheDocument();
    expect(screen.getByText(/two photos of each person/)).toBeInTheDocument();
  });

  it('shows each person as Waiting for photos, Ready to approve or Sent', async () => {
    await renderTab();
    const step5 = document.getElementById('booth-approve')!;
    expect(within(step5).getByText('Approve all for Zeb')).toBeInTheDocument();
    expect(within(step5).getByText('Approve all for Seth')).toBeInTheDocument(); // the group shot is new
    expect(within(step5).getByText('Waiting for photos')).toBeInTheDocument();
    const step2 = document.getElementById('booth-people')!;
    expect(within(step2).getByText('m***@gmail.com · text ·', { exact: false })).toBeInTheDocument();
  });

  it('asks before sending everything, and sends nothing if the host says no', async () => {
    await renderTab();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByText('Approve and send everything (3 photos)'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('real emails'));
    expect(decideProPhoto).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await act(async () => {
      fireEvent.click(screen.getByText('Approve and send everything (3 photos)'));
    });
    await waitFor(() => expect(decideProPhoto).toHaveBeenCalledTimes(3));
    expect(decideProPhoto).toHaveBeenCalledWith('p3', 'approve');
  });

  it('sorts with plain buttons: open a group, pick photos, move them', async () => {
    await renderTab();
    fireEvent.click(screen.getByText('Not matched to anyone'));
    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));
    fireEvent.change(screen.getByLabelText('Who are they of?'), { target: { value: 'a3' } });
    expect(screen.getByText('Mark as QR shot')).toBeInTheDocument();
    expect(screen.getByText('Unassign (nobody)')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('Move to this person'));
    });
    expect(assignBoothPhotos).toHaveBeenCalledWith({ eventId: 'e1', uploadIds: ['p5'], action: 'set', attendeeId: 'a3' });
  });
});
