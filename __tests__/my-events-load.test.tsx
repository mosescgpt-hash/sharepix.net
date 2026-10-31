/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { act, fireEvent, render, screen } from '@testing-library/react';

const listMyEvents = jest.fn();
jest.mock('@/lib/api', () => ({
  listMyEvents: () => listMyEvents(),
  deleteEventWithPhotos: jest.fn(),
  deleteMyEvent: jest.fn(),
  downloadEventsAsZip: jest.fn(),
  startCheckout: jest.fn(),
}));
const isGlobalAdmin = jest.fn();
jest.mock('@/lib/admin', () => ({ isGlobalAdmin: () => isGlobalAdmin() }));
jest.mock('@/components/hostAuth', () => ({ withHostAuth: (c: unknown) => c }));
jest.mock('@/components/HostHeader', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Layout', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import MyEvents from '@/pages/my-events';

const ev = { id: 'a', name: 'Alpha', tier: 'basic', eventCode: 'A', date: '2027-01-01', paid: true, photoCount: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  isGlobalAdmin.mockResolvedValue(false);
});
afterEach(() => jest.useRealTimers());

describe('My events loading', () => {
  it('does not sit on "Loading your events" forever when the request never answers', async () => {
    listMyEvents.mockReturnValueOnce(new Promise(() => undefined));
    render(<MyEvents />);
    expect(screen.getByText(/^Loading your events…$/)).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(26_000);
    });
    expect(screen.getByText(/taking too long/)).toBeTruthy();
    expect(screen.queryByText(/^Loading your events…$/)).toBeNull();

    listMyEvents.mockResolvedValueOnce([ev]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findByText('Alpha')).toBeTruthy();
  });

  it('an admin check that stalls does not block the list', async () => {
    isGlobalAdmin.mockReturnValue(new Promise(() => undefined));
    listMyEvents.mockResolvedValue([ev]);
    render(<MyEvents />);
    await act(async () => {
      jest.advanceTimersByTime(8_500);
    });
    expect(await screen.findByText('Alpha')).toBeTruthy();
  });

  it('shows an error and Try again when the list fails outright', async () => {
    listMyEvents.mockRejectedValueOnce(new Error('boom'));
    render(<MyEvents />);
    expect(await screen.findByText(/could not load your events/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a late answer from an abandoned attempt cannot overwrite a retry', async () => {
    let late: (v: unknown) => void = () => undefined;
    listMyEvents.mockReturnValueOnce(new Promise((r) => (late = r)));
    render(<MyEvents />);
    await act(async () => {
      jest.advanceTimersByTime(26_000);
    });
    listMyEvents.mockResolvedValueOnce([ev]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    await screen.findByText('Alpha');
    await act(async () => late([]));
    expect(screen.getByText('Alpha')).toBeTruthy();
  });
});
