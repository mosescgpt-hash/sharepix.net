/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const listMyEvents = jest.fn();
const deleteEventWithPhotos = jest.fn();
jest.mock('@/lib/api', () => ({
  listMyEvents: () => listMyEvents(),
  deleteEventWithPhotos: (id: string) => deleteEventWithPhotos(id),
  deleteMyEvent: jest.fn(),
  downloadEventsAsZip: jest.fn(),
  startCheckout: jest.fn(),
}));
jest.mock('@/lib/admin', () => ({ isGlobalAdmin: () => Promise.resolve(false) }));
jest.mock('@/components/hostAuth', () => ({ withHostAuth: (c: unknown) => c }));
jest.mock('@/components/HostHeader', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Layout', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import MyEvents from '@/pages/my-events';

const ev = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  tier: 'basic',
  eventCode: id.toUpperCase(),
  date: '2027-01-01',
  paid: true,
  photoCount: 4,
  ...extra,
});

describe('My events: Delete selected', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listMyEvents.mockResolvedValue([ev('a', 'Alpha'), ev('b', 'Bravo'), ev('c', 'Charlie')]);
    deleteEventWithPhotos.mockResolvedValue(undefined);
  });

  it('uses the existing checkboxes, and is disabled until something is selected', async () => {
    render(<MyEvents />);
    await screen.findByText('Alpha');
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect((screen.getByRole('button', { name: 'Delete selected (0)' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Delete selected (3)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download selected (3)' })).toBeTruthy();
  });

  it('confirms with the count and a photo warning; nothing is deleted until DELETE is typed', async () => {
    render(<MyEvents />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByLabelText('Select Alpha for download'));
    fireEvent.click(screen.getByLabelText('Select Bravo for download'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete 2 events?')).toBeTruthy();
    expect(dialog.textContent).toMatch(/permanently removes these events and 8 photos/);
    const confirm = within(dialog).getByRole('button', { name: 'Permanently delete 2 events' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(deleteEventWithPhotos).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    expect(confirm.disabled).toBe(false);
  });

  it('cancel closes the dialog without deleting', async () => {
    render(<MyEvents />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByLabelText('Select Alpha for download'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (1)' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deleteEventWithPhotos).not.toHaveBeenCalled();
  });

  it('deletes each selected event with the single-delete function and removes them from the list', async () => {
    render(<MyEvents />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByLabelText('Select Alpha for download'));
    fireEvent.click(screen.getByLabelText('Select Charlie for download'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DELETE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Permanently delete 2 events' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteEventWithPhotos.mock.calls).toEqual([['a'], ['c']]);
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Bravo')).toBeTruthy();
    expect(screen.getByText(/2 of 2 events deleted/)).toBeTruthy();
  });

  it('lists the events that failed, keeps them selected, and still removes the others', async () => {
    deleteEventWithPhotos.mockImplementation(async (id: string) => {
      if (id === 'b') throw new Error('A photo record could not be removed.');
    });
    render(<MyEvents />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (3)' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DELETE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Permanently delete 3 events' }));
    expect(await screen.findByText(/2 of 3 events deleted/)).toBeTruthy();
    expect(screen.getByText(/Bravo: A photo record could not be removed\./)).toBeTruthy();
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Bravo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete selected (1)' })).toBeTruthy();
  });

  it('leaves unpaid events out of the selection (they keep Cancel event)', async () => {
    listMyEvents.mockResolvedValue([ev('a', 'Alpha'), ev('u', 'Unpaid', { paid: false })]);
    render(<MyEvents />);
    await screen.findByText('Alpha');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cancel event' })).toBeTruthy();
  });
});
