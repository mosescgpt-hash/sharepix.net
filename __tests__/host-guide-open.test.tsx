import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HostGuide from '@/components/HostGuide';
import type { QREvent } from '@/lib/types';

/**
 * Whether the quick-start greets a host or waits to be asked.
 *
 * The dashboard opens it for an event with no photos yet and leaves it closed
 * once photos exist — a host on day one needs the instructions, a host on their
 * third event does not, and the photo count tells the two apart without asking
 * anybody anything.
 *
 * Rendered rather than read off the source, because the question here is what a
 * person sees. `__tests__/admin-layout.test.ts` checks that the dashboard picks
 * the right branch; this checks that the branch does what it claims.
 */

const EVENT = {
  id: 'e1',
  name: 'A Wedding',
  eventCode: 'coffee-lamp-river',
} as unknown as QREvent;

/** The heading is always rendered; the steps only when it is open. */
const FIRST_STEP = /Get guests adding photos/i;

describe('HostGuide', () => {
  it('is closed by default', () => {
    render(<HostGuide event={EVENT} />);
    expect(screen.getByText(/How to run your event/i)).toBeInTheDocument();
    expect(screen.queryByText(FIRST_STEP)).not.toBeInTheDocument();
  });

  it('is open when the dashboard asks for it', () => {
    render(<HostGuide event={EVENT} defaultOpen />);
    expect(screen.getByText(FIRST_STEP)).toBeInTheDocument();
  });

  it('shows the event code, so it can be read out', () => {
    render(<HostGuide event={EVENT} defaultOpen />);
    expect(screen.getByText('coffee-lamp-river')).toBeInTheDocument();
  });

  it('stays closed once a host closes it', async () => {
    // `defaultOpen` is the initial state, not a binding. Re-opening the guide
    // under a host who just closed it would be the page arguing with them.
    render(<HostGuide event={EVENT} defaultOpen />);
    await userEvent.click(screen.getByRole('button', { name: /How to run your event/i }));
    expect(screen.queryByText(FIRST_STEP)).not.toBeInTheDocument();
  });

  it('offers the QR code as a link back rather than a switch', async () => {
    // It used to have to reveal the code as well as scroll to it. The code is
    // no longer hidden, so this is only ever a scroll.
    const onShowQR = jest.fn();
    render(<HostGuide event={EVENT} defaultOpen onShowQR={onShowQR} />);
    await userEvent.click(screen.getByRole('button', { name: /open it here/i }));
    expect(onShowQR).toHaveBeenCalledTimes(1);
  });

  it('falls back to prose when there is nothing to scroll to', () => {
    // Rendered without the callback — on a page with no QR card, the sentence
    // must not point at a button that is not there.
    render(<HostGuide event={EVENT} defaultOpen />);
    expect(screen.queryByRole('button', { name: /open it here/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Show QR code/i)).toBeInTheDocument();
  });
});
