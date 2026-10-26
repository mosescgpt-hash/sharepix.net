/** Mock booth data for the Booth tab's tests (and its screenshots). */
export const mockAttendees = [
  { id: 'a1', name: 'Zeb', contactLabel: 'z***@gmail.com', texting: false, consentedAt: null, galleryKey: 'gk1', lastDeliveredAt: null, emailsStopped: false },
  { id: 'a2', name: 'Seth', contactLabel: 'm***@gmail.com', texting: true, consentedAt: null, galleryKey: 'gk2', lastDeliveredAt: '2026-10-24T20:00:00Z', emailsStopped: false },
  { id: 'a3', name: 'Maria', contactLabel: '***-***-4567', texting: true, consentedAt: null, galleryKey: 'gk3', lastDeliveredAt: null, emailsStopped: false },
];

const row = (attendeeIds: string[], names: string[], match: string, publishStatus: string | null, n: number) => ({
  attendeeName: names[0] ?? null,
  attendeeIds,
  attendeeNames: names,
  match,
  thumbUrl: `https://picsum.photos/seed/booth${n}/300/300`,
  publishStatus,
  createdAt: `2026-10-24T18:${String(n).padStart(2, '0')}:00Z`,
});

export function mockStatus() {
  return {
    booth: true,
    currentName: null,
    currentScannedAt: null,
    clockSynced: true,
    clockOffsetMs: 0,
    asHost: true,
    people: mockAttendees.map((a) => ({ attendeeId: a.id, name: a.name })),
    assignments: new Map([
      ['q1', row([], [], 'divider', null, 1)],
      ['p1', row(['a1'], ['Zeb'], 'divider-time', 'awaiting_review', 2)],
      ['p2', row(['a1'], ['Zeb'], 'divider-time', 'awaiting_review', 3)],
      ['p3', row(['a1', 'a2'], ['Zeb', 'Seth'], 'divider-time', 'awaiting_review', 4)],
      ['q2', row([], [], 'divider', null, 5)],
      ['p4', row(['a2'], ['Seth'], 'divider-time', 'approved', 6)],
      ['p5', row([], [], 'unassigned', 'awaiting_review', 7)],
    ]),
  };
}
