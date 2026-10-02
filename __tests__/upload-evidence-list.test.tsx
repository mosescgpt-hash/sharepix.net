import { fireEvent, render, screen } from '@testing-library/react';
import UploadEvidenceList from '@/components/UploadEvidenceList';

jest.mock('@/lib/api', () => ({
  listUploadEvidence: jest.fn(async () => [
    {
      photoId: 'p1',
      sourceIp: '203.0.113.9',
      callerId: 'us-east-1:abc',
      uploadedBy: 'Guest 7',
      reasons: 'Explicit Nudity',
      recordedAt: '2026-10-02T10:00:00.000Z',
    },
  ]),
}));

describe('UploadEvidenceList', () => {
  it('loads nothing until an admin opens it, then shows the address and identity', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const api = require('@/lib/api');
    render(<UploadEvidenceList eventId="ev1" />);
    expect(api.listUploadEvidence).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Uploader details for flagged photos'));
    expect(await screen.findByText('203.0.113.9')).toBeInTheDocument();
    expect(screen.getByText('us-east-1:abc')).toBeInTheDocument();
    expect(api.listUploadEvidence).toHaveBeenCalledWith('ev1');
  });
});
