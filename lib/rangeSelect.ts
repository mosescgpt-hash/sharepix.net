/**
 * Shift-click selection on a photo grid: the ids from the last photo clicked
 * to this one, inclusive, in grid order, whichever way round they were
 * clicked. Just this one when there is no earlier click or it is gone from
 * the grid.
 */
export function idsInRange(orderedIds: readonly string[], anchorId: string | null, id: string): string[] {
  const to = orderedIds.indexOf(id);
  if (to === -1) return [];
  const from = anchorId === null ? -1 : orderedIds.indexOf(anchorId);
  if (from === -1) return [id];
  const [start, end] = from <= to ? [from, to] : [to, from];
  return orderedIds.slice(start, end + 1);
}

/**
 * The selection after a click. A plain click toggles one photo; a shift-click
 * sets every photo in the range to what the clicked photo becomes, so a
 * range can be picked or un-picked in one go.
 */
export function applyClick(
  selected: ReadonlySet<string>,
  orderedIds: readonly string[],
  anchorId: string | null,
  id: string,
  shift: boolean,
): Set<string> {
  const next = new Set(selected);
  const select = !selected.has(id);
  const ids = shift ? idsInRange(orderedIds, anchorId, id) : [id];
  for (const each of ids) {
    if (select) next.add(each);
    else next.delete(each);
  }
  return next;
}
