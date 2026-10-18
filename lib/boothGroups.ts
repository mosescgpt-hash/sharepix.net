/**
 * How the booth fix-up screen groups a photographer's photos
 * (docs/booth-mode.md, step 3). Pure, so it is tested directly.
 */

export interface BoothAssignmentLike {
  attendeeIds: string[];
  attendeeNames: string[];
  match: string;
}

export interface BoothGroup {
  /** 'check', 'none', or an attendee id. */
  key: string;
  label: string;
  photoIds: string[];
}

/**
 * Check first (matched by upload time, so worth a look), then photos going to
 * nobody, then one group per person in the order they were scanned (newest
 * first). A group shot appears under every person it goes to.
 */
export function boothGroups(
  photoIds: readonly string[],
  assignments: ReadonlyMap<string, BoothAssignmentLike>,
  peopleOrder: readonly { attendeeId: string; name: string }[],
): BoothGroup[] {
  const check: string[] = [];
  const none: string[] = [];
  const byPerson = new Map<string, { label: string; photoIds: string[] }>();

  for (const id of photoIds) {
    const a = assignments.get(id);
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
    ...people,
  ];
}
