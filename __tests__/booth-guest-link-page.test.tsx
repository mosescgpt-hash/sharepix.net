/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { render, screen, waitFor } from '@testing-library/react';

const replace = jest.fn();
jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query: { eventId: 'e1', code: 't.tok_ABC-123456789xyz' }, replace }),
}));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
const openBoothGuestLink = jest.fn();
jest.mock('@/lib/api', () => ({ openBoothGuestLink: (c: string) => openBoothGuestLink(c) }));

import BoothGuestLinkPage from '@/pages/b/[eventId]/[code]';

describe('scanning a guest code with the phone camera', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens the in-app photo session for that guest', async () => {
    openBoothGuestLink.mockResolvedValue({ ok: true, message: '', key: 'KEY 1' });
    render(<BoothGuestLinkPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/booth/capture/KEY%201'));
    expect(openBoothGuestLink).toHaveBeenCalledWith('https://www.sharepix.net/b/e1/t.tok_ABC-123456789xyz');
  });

  it('shows the server’s plain words when the code is not one a guest can open', async () => {
    openBoothGuestLink.mockResolvedValue({ ok: false, message: 'This is a booth control code for the host or photographer.', key: null });
    render(<BoothGuestLinkPage />);
    expect(await screen.findByText(/control code for the host/)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
