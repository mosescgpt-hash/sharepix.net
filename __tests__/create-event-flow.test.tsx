/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const query: Record<string, string> = {};
jest.mock('next/router', () => ({
  useRouter: () => ({
    query,
    push: jest.fn(),
    events: { on: () => undefined, off: () => undefined },
  }),
}));
// The page itself, without the sign-in wall around it.
jest.mock('@/components/hostAuth', () => ({
  withHostAuth: (page: unknown) => page,
}));
jest.mock('@/components/Layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/EventQRCode', () => ({ __esModule: true, default: () => null }));

const createNewEvent = jest.fn();
const applyStarterLook = jest.fn();
const applyInitialGalleryAccess = jest.fn();
jest.mock('@/lib/api', () => ({
  createNewEvent: (...args: unknown[]) => createNewEvent(...args),
  applyStarterLook: (...args: unknown[]) => applyStarterLook(...args),
  applyInitialGalleryAccess: (...args: unknown[]) => applyInitialGalleryAccess(...args),
  getMyCorporateSubscription: () => Promise.resolve(null),
  isCorporateActive: () => false,
  startCheckout: jest.fn(),
  validateDiscountCode: jest.fn(),
  trackEvent: jest.fn(),
}));

import CreateEventPage from '@/pages/create-event';

beforeEach(() => {
  createNewEvent.mockReset();
  applyStarterLook.mockReset();
  applyInitialGalleryAccess.mockReset();
  applyInitialGalleryAccess.mockResolvedValue(true);
  for (const key of Object.keys(query)) delete query[key];
  window.scrollTo = jest.fn();
});

describe('creating an event', () => {
  it('asks the event type first, then narrows the form to it', () => {
    render(<CreateEventPage />);
    expect(screen.getByText('What are you celebrating?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Event name')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Wedding' }));
    expect(screen.getByLabelText('Event name')).toHaveAttribute(
      'placeholder',
      'Sam & Riley’s Wedding',
    );
    // Three looks that suit a wedding, the first already chosen.
    expect(screen.getByRole('radio', { name: 'Ivory' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Romantic' })).toBeInTheDocument();
    // Weddings are guests' events; the audience question is not asked.
    expect(screen.queryByText('Who will be adding the photos?')).toBeNull();
  });

  it('asks who adds the photos only where "just me" is common', () => {
    render(<CreateEventPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Church event' }));
    expect(screen.getByText('Who will be adding the photos?')).toBeInTheDocument();
  });

  it('skips step one when the link names the type', () => {
    query.type = 'corporate';
    render(<CreateEventPage />);
    expect(screen.getByLabelText('Event name')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Signature' })).toBeChecked();
  });

  it('shows the name in the look preview as it is typed', () => {
    render(<CreateEventPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Birthday' }));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Ana Turns 30' } });
    expect(screen.getByText('Ana Turns 30')).toBeInTheDocument();
  });

  it('stores the type and applies the chosen look to the new event', async () => {
    createNewEvent.mockResolvedValue({ id: 'evt-1', name: 'Ana', tier: 'trial', paid: true });
    applyStarterLook.mockResolvedValue(undefined);
    render(<CreateEventPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Birthday' }));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Coastal' }));
    fireEvent.submit(screen.getByLabelText('Event name').closest('form')!);

    await waitFor(() => expect(applyStarterLook).toHaveBeenCalled());
    expect(createNewEvent.mock.calls[0][0]).toMatchObject({
      name: 'Ana',
      eventType: 'birthday',
      uploadAudience: 'guests',
    });
    expect(applyStarterLook.mock.calls[0][0]).toBe('evt-1');
    expect(applyStarterLook.mock.calls[0][1]).toMatchObject({ coverPreset: 'ocean' });
    expect(await screen.findByText('is live.')).toBeInTheDocument();
  });

  it('saves the guest-access choices on the new event', async () => {
    createNewEvent.mockResolvedValue({ id: 'evt-3', name: 'Ana', tier: 'trial', paid: true });
    applyStarterLook.mockResolvedValue(undefined);
    render(<CreateEventPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Birthday' }));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('switch', { name: /Guests can download/ }));
    fireEvent.change(screen.getByLabelText(/Gallery PIN/), { target: { value: '12ab3456789' } });
    // Letters are dropped and six digits is the longest.
    expect(screen.getByLabelText(/Gallery PIN/)).toHaveValue('123456');
    fireEvent.click(screen.getByRole('switch', { name: /Require it from the start/ }));
    fireEvent.submit(screen.getByLabelText('Event name').closest('form')!);

    await waitFor(() => expect(applyInitialGalleryAccess).toHaveBeenCalled());
    expect(applyInitialGalleryAccess).toHaveBeenCalledWith('evt-3', {
      viewBlocked: false,
      downloadsBlocked: true,
      pin: '123456',
      pinNow: true,
    });
    expect(await screen.findByText('is live.')).toBeInTheDocument();
    expect(screen.queryByText('Check guest access')).toBeNull();
  });

  it('refuses a PIN that is not 4 to 6 digits', async () => {
    render(<CreateEventPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Birthday' }));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText(/Gallery PIN/), { target: { value: '12' } });
    fireEvent.submit(screen.getByLabelText('Event name').closest('form')!);
    expect(await screen.findByText(/A gallery PIN is 4 to 6 digits/)).toBeInTheDocument();
    expect(createNewEvent).not.toHaveBeenCalled();
  });

  it('says so when the guest-access choices did not save, and still finishes', async () => {
    createNewEvent.mockResolvedValue({ id: 'evt-4', name: 'Ana', tier: 'trial', paid: true });
    applyStarterLook.mockResolvedValue(undefined);
    applyInitialGalleryAccess.mockResolvedValue(false);
    render(<CreateEventPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Birthday' }));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Ana' } });
    fireEvent.submit(screen.getByLabelText('Event name').closest('form')!);
    expect(await screen.findByText('is live.')).toBeInTheDocument();
    expect(screen.getByText('Check guest access')).toBeInTheDocument();
  });

  it('still finishes when the look cannot be saved', async () => {
    createNewEvent.mockResolvedValue({ id: 'evt-2', name: 'Ana', tier: 'trial', paid: true });
    applyStarterLook.mockRejectedValue(new Error('nope'));
    render(<CreateEventPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Birthday' }));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Ana' } });
    fireEvent.submit(screen.getByLabelText('Event name').closest('form')!);
    expect(await screen.findByText('is live.')).toBeInTheDocument();
  });
});
