import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReminderOptInCard from '@/components/uploadReminders/ReminderOptInCard';
import { requestUploadReminder } from '@/lib/uploadReminders/api';
import type { QREvent } from '@/lib/types';

jest.mock('@/lib/uploadReminders/api', () => ({
  requestUploadReminder: jest.fn(async () => ({ ok: true, message: 'Done. We’ll email you tomorrow morning.' })),
}));

const base = {
  id: 'ev1',
  name: 'Anderson Wedding',
  eventCode: 'maple-otter-lantern',
  date: '2026-06-06',
  uploadWindowEndsAt: '2026-08-05T05:00:00.000Z',
  timeZone: 'America/Chicago',
  uploadRemindersEnabled: true,
} as unknown as QREvent;

describe('ReminderOptInCard', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: Date.parse('2026-06-06T23:00:00Z') });
    window.sessionStorage.clear();
    (requestUploadReminder as jest.Mock).mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('renders nothing when the host has not turned reminders on', () => {
    const { container } = render(<ReminderOptInCard event={{ ...base, uploadRemindersEnabled: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks about tomorrow, with the consent line', () => {
    render(<ReminderOptInCard event={base} />);
    expect(screen.getByLabelText('Want a reminder tomorrow to add more photos?')).toBeInTheDocument();
    expect(screen.getByText(/The host can’t see it/)).toBeInTheDocument();
  });

  it('is gone in one tap, and stays gone for this visit', () => {
    const { unmount } = render(<ReminderOptInCard event={base} />);
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(screen.queryByText(/Want a reminder/)).not.toBeInTheDocument();
    unmount();
    render(<ReminderOptInCard event={base} />);
    expect(screen.queryByText(/Want a reminder/)).not.toBeInTheDocument();
  });

  it('checks the address before sending it anywhere', () => {
    render(<ReminderOptInCard event={base} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remind me' }));
    expect(screen.getByRole('alert')).toHaveTextContent('doesn’t look like an email');
    expect(requestUploadReminder).not.toHaveBeenCalled();
  });

  it('sends a valid address and confirms', async () => {
    jest.useRealTimers();
    jest.useFakeTimers({ now: Date.parse('2026-06-06T23:00:00Z'), doNotFake: ['setTimeout', 'queueMicrotask', 'nextTick'] });
    render(<ReminderOptInCard event={base} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' Sam@Example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remind me' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('tomorrow morning'));
    expect(requestUploadReminder).toHaveBeenCalledWith('ev1', 'sam@example.com');
  });
});
