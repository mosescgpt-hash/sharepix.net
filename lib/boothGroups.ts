/**
 * How the booth fix-up screen groups a photographer's photos
 * (docs/booth-mode.md, step 3). Pure, so it is tested directly.
 */

export interface BoothAssignmentLike {
  attendeeIds: string[];
  attendeeNames: string[];
  match: string;
  /** From start/stop codes: event, category, person, stopped or unsorted. */
  segment?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
}

export interface BoothGroup {
  /** 'check', 'none', 'event', 'cat:<id>', 'stopped', 'dividers', or an attendee id. */
  key: string;
  label: string;
  photoIds: string[];
}

/**
 * Check first (matched by upload time, so worth a look), then photos going to
 * nobody (including photos with no camera time that no divider could place), then the event's general photos and each category's (start codes),
 * then one group per person in the order they were scanned (newest
 * first), then photos taken after a stop code, then QR divider shots last. A group shot appears under every person it goes to.
 */
export function boothGroups(
  photoIds: readonly string[],
  assignments: ReadonlyMap<string, BoothAssignmentLike>,
  peopleOrder: readonly { attendeeId: string; name: string }[],
): BoothGroup[] {
  const check: string[] = [];
  const none: string[] = [];
  const dividers: string[] = [];
  const eventPhotos: string[] = [];
  const stopped: string[] = [];
  const byCategory = new Map<string, { label: string; photoIds: string[] }>();
  const byPerson = new Map<string, { label: string; photoIds: string[] }>();

  for (const id of photoIds) {
    const a = assignments.get(id);
    if (a?.match === 'divider') {
      dividers.push(id);
      continue;
    }
    if (a && a.attendeeIds.length === 0 && a.segment === 'stopped') {
      stopped.push(id);
      continue;
    }
    if (a && a.attendeeIds.length === 0 && a.segment === 'category' && a.categoryId) {
      const group = byCategory.get(a.categoryId) ?? { label: a.categoryName || 'Category', photoIds: [] };
      group.photoIds.push(id);
      byCategory.set(a.categoryId, group);
      continue;
    }
    if (a && a.attendeeIds.length === 0 && a.segment === 'event') {
      eventPhotos.push(id);
      continue;
    }
    if (!a || a.attendeeIds.length === 0) {
      none.push(id);
      continue;
    }
    if (a.match === 'upload') check.push(id);
    a.attendeeIds.forEach((personId, i) => {
      const group = byPerson.get(personId) ?? { label: a.attendeeNames[i] ?? 'Guest', photoIds: [] };
      group.photoIds.push(id);
      byPerson.set(personId, group);
    });
  }

  const rank = new Map(peopleOrder.map((p, i) => [p.attendeeId, i]));
  const people = [...byPerson.entries()]
    .sort(([a], [b]) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity))
    .map(([key, g]) => ({ key, label: g.label, photoIds: g.photoIds }));

  return [
    ...(check.length ? [{ key: 'check', label: 'Check — matched by upload time', photoIds: check }] : []),
    ...(none.length ? [{ key: 'none', label: 'Not matched to anyone', photoIds: none }] : []),
    // Start codes: the event's general photos, then each category's.
    ...(eventPhotos.length ? [{ key: 'event', label: 'Event photos', photoIds: eventPhotos }] : []),
    ...[...byCategory.entries()].map(([cid, g]) => ({ key: `cat:${cid}`, label: `${g.label} — category photos`, photoIds: g.photoIds })),
    ...people,
    // After a stop code: held, not sent, until someone moves them.
    ...(stopped.length ? [{ key: 'stopped', label: 'Stopped — held, not sent', photoIds: stopped }] : []),
    // QR code shots (offline booth): kept for checking, never sent to anyone.
    ...(dividers.length ? [{ key: 'dividers', label: 'QR code shots — never sent', photoIds: dividers }] : []),
  ];
}
