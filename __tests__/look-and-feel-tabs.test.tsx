/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { fireEvent, render, screen } from '@testing-library/react';
import GalleryStyleSettings from '@/components/GalleryStyleSettings';

jest.mock('@/lib/api', () => ({
  applyStarterLook: jest.fn(() => Promise.resolve()),
  getEventCoverSource: jest.fn(() => new Promise(() => undefined)),
  setEventCover: jest.fn(),
  setEventEngagement: jest.fn(),
  setEventGalleryTheme: jest.fn(),
  uploadEventCoverImage: jest.fn(),
}));

const event = { id: 'evt-1', name: 'Our Wedding' } as never;

describe('Look and feel, in tabs', () => {
  it('opens on Looks and shows one tab at a time, with the preview always there', () => {
    render(<GalleryStyleSettings event={event} onSaved={() => undefined} />);
    expect(screen.getByRole('tab', { name: 'Looks' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByText('Start with a look')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }));
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.queryByText('Start with a look')).toBeNull();
    expect(screen.getByText('Likes and comments')).toBeInTheDocument();
    // The preview sits outside the tabs.
    expect(screen.getByText(/^Preview\./)).toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys', () => {
    render(<GalleryStyleSettings event={event} onSaved={() => undefined} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Custom' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Looks' })).toHaveAttribute('aria-selected', 'true');
  });

  it('marks the Custom tab while it has unsaved changes', () => {
    render(<GalleryStyleSettings event={event} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }));
    expect(screen.queryByLabelText('unsaved changes')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Our Wedding'), { target: { value: 'Us' } });
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
    // Still marked from another tab, which is the point of it.
    fireEvent.click(screen.getByRole('tab', { name: 'Fonts' }));
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
  });

  it('puts the looks that suit the event type first', () => {
    render(
      <GalleryStyleSettings
        event={{ id: 'evt-2', name: 'Pat & Lee', eventType: 'wedding' } as never}
        onSaved={() => undefined}
      />,
    );
    expect(screen.getByText('Suggested for wedding')).toBeInTheDocument();
    const looks = screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent);
    expect(looks[0]).toMatch(/^Ivory/);
    expect(screen.getByText('More looks')).toBeInTheDocument();
  });

  it('shows every look in one list for an event without a type', () => {
    render(<GalleryStyleSettings event={event} onSaved={() => undefined} />);
    expect(screen.queryByText(/^Suggested for/)).toBeNull();
    expect(screen.getByText('Signature')).toBeInTheDocument();
  });

  it('opens the tab the dashboard asks for', () => {
    const { rerender } = render(
      <GalleryStyleSettings event={event} onSaved={() => undefined} requestedTab={null} />,
    );
    rerender(
      <GalleryStyleSettings
        event={event}
        onSaved={() => undefined}
        requestedTab={{ key: 'cover', n: 1 }}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Cover' })).toHaveAttribute('aria-selected', 'true');
  });
});
