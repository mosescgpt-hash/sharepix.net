/**
 * The Booth tab's plain status for each person (docs/booth-mode.md). Pure, so
 * it is tested directly.
 *
 *   waiting  No photos are matched to them yet.
 *   ready    They have photos, and at least one is not approved yet.
 *   sent     Every one of their photos is approved (the email goes out
 *            within the hour, or already has).
 */

export type BoothPersonState = 'waiting' | 'ready' | 'sent';

export interface BoothAssignmentForStatus {
  attendeeIds: string[];
  match: string;
  publishStatus: string | null;
}

export interface BoothPersonStatus {
  attendeeId: string;
  name: string;
  state: BoothPersonState;
  /** Their photos, QR shots and rejected photos left out. */
  photoIds: string[];
  /** The ones still to approve. */
  toApprove: string[];
}

export const BOOTH_STATE_LABEL: Record<BoothPersonState, string> = {
  waiting: 'Waiting for photos',
  ready: 'Ready to approve',
  sent: 'Sent',
};

/** Photos that count: not a QR code shot, not rejected. */
function counts(a: BoothAssignmentForStatus): boolean {
  return a.match !== 'divider' && a.publishStatus !== 'rejected';
}

export function boothPersonStatuses(
  people: readonly { attendeeId: string; name: string }[],
  assignments: ReadonlyMap<string, BoothAssignmentForStatus>,
): BoothPersonStatus[] {
  return people.map(({ attendeeId, name }) => {
    const photoIds: string[] = [];
    const toApprove: string[] = [];
    for (const [id, a] of assignments) {
      if (!counts(a) || !a.attendeeIds.includes(attendeeId)) continue;
      photoIds.push(id);
      if (a.publishStatus !== 'approved' && a.publishStatus !== 'published') toApprove.push(id);
    }
    const state: BoothPersonState =
      photoIds.length === 0 ? 'waiting' : toApprove.length > 0 ? 'ready' : 'sent';
    return { attendeeId, name, state, photoIds, toApprove };
  });
}

/** Every photo "Approve and send everything" would approve, each once. */
export function everythingToApprove(statuses: readonly BoothPersonStatus[]): string[] {
  return [...new Set(statuses.flatMap((s) => s.toApprove))];
}

/** "1 photo" / "3 photos". */
export function photoCount(n: number): string {
  return `${n} photo${n === 1 ? '' : 's'}`;
}
