/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const emailBoothLink = jest.fn();
jest.mock('@/lib/api', () => ({
  emailBoothLink: (...a: unknown[]) => (emailBoothLink as (...x: unknown[]) => unknown)(...a),
}));

import BoothLinkEmail from '@/components/BoothLinkEmail';
import { BOOTH_CONSENT_TEXT } from '@/lib/booth';

describe('Stop screen: email my link', () => {
  beforeEach(() => jest.clearAllMocks());

  it('with an address on file, emails the link at once and shows it masked', async () => {
    emailBoothLink.mockResolvedValue({ ok: true, message: 'Your link is on its way.', emailHint: 'j***@gmail.com', sent: true });
    render(<BoothLinkEmail galleryKey="KEY" emailHint="j***@gmail.com" emailsStopped={false} />);
    expect(await screen.findByText(/We'll email you at j\*\*\*@gmail\.com/)).toBeTruthy();
    expect(emailBoothLink).toHaveBeenCalledTimes(1);
    expect(emailBoothLink).toHaveBeenCalledWith('KEY');
    expect(screen.getByText(/once the host approves them/)).toBeTruthy();
  });

  it('says the same friendly thing when it was emailed a moment ago', async () => {
    emailBoothLink.mockResolvedValue({ ok: true, message: 'Your link was emailed a moment ago.', emailHint: 'j***@gmail.com', sent: false });
    render(<BoothLinkEmail galleryKey="KEY" emailHint="j***@gmail.com" emailsStopped={false} />);
    expect(await screen.findByText(/We'll email you at j\*\*\*@gmail\.com/)).toBeTruthy();
  });

  it('shows nothing and sends nothing when they stopped emails', () => {
    const { container } = render(<BoothLinkEmail galleryKey="KEY" emailHint="j***@gmail.com" emailsStopped />);
    expect(container.textContent).toBe('');
    expect(emailBoothLink).not.toHaveBeenCalled();
  });

  it('with no address, offers a form that needs the tick, then masks what they gave', async () => {
    emailBoothLink.mockResolvedValue({ ok: true, message: 'Your link is on its way.', emailHint: 'n***@example.com', sent: true });
    render(<BoothLinkEmail galleryKey="KEY" emailHint={null} emailsStopped={false} />);
    expect(emailBoothLink).not.toHaveBeenCalled();
    const send = screen.getByRole('button', { name: 'Email me my link' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    expect(send.disabled).toBe(true);
    expect(screen.getByText(BOOTH_CONSENT_TEXT)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(emailBoothLink).toHaveBeenCalledWith('KEY', { email: 'new@example.com', consent: true }));
    expect(await screen.findByText(/We'll email you at n\*\*\*@example\.com/)).toBeTruthy();
  });

  it('shows a refusal in words, and keeps the link usable', async () => {
    emailBoothLink.mockResolvedValue({ ok: false, message: 'Check the email address.', emailHint: null, sent: false });
    render(<BoothLinkEmail galleryKey="KEY" emailHint={null} emailsStopped={false} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Email me my link' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Check the email address.');
  });
});
