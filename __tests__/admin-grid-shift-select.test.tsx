/** @jest-environment jsdom */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AdminPhotoGrid from '../components/AdminPhotoGrid';
import type { DisplayPhoto } from '../lib/types';

jest.mock('../lib/api', () => ({
  deleteEventPhoto: jest.fn(),
  releaseFlaggedPhoto: jest.fn(),
  setPhotoApproval: jest.fn(),
}));

const photos = ['p1', 'p2', 'p3', 'p4', 'p5'].map(
  (id) => ({ id, eventId: 'e', s3Key: `events/e/${id}.jpg`, url: `https://x/${id}.jpg`, approved: true }) as unknown as DisplayPhoto,
);

describe('shift-click on the Manage grid', () => {
  it('selects everything between two clicks for deletion', () => {
    render(<AdminPhotoGrid photos={photos} onChanged={() => {}} />);
    fireEvent.click(screen.getByText('Select photos to delete'));
    const tiles = () => screen.getAllByRole('button', { name: /for deletion/ });
    fireEvent.click(tiles()[1]);
    fireEvent.click(tiles()[3], { shiftKey: true });
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(tiles().map((t) => t.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'true', 'true', 'false']);
  });

  it('selects a range for the download QR, starting from a cleared grid', () => {
    function Host() {
      const [picked, setPicked] = useState<Set<string>>(new Set());
      const toggle = (id: string) =>
        setPicked((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      return <AdminPhotoGrid photos={photos} onChanged={() => {}} selectable selectedIds={picked} onToggleSelected={toggle} />;
    }
    render(<Host />);
    const toggles = () => screen.getAllByRole('button', { name: /download QR/ });
    fireEvent.click(toggles()[4]);
    fireEvent.click(toggles()[0], { shiftKey: true });
    expect(toggles().every((t) => t.getAttribute('aria-pressed') === 'true')).toBe(true);
  });
});
