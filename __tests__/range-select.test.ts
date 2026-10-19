import { applyClick, idsInRange } from '../lib/rangeSelect';
import { codeOnly, readSource } from './sourceGuards';

const ids = ['a', 'b', 'c', 'd', 'e'];

describe('shift-click ranges', () => {
  it('covers everything from the last click to this one, either direction', () => {
    expect(idsInRange(ids, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(idsInRange(ids, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(idsInRange(ids, null, 'c')).toEqual(['c']);
    expect(idsInRange(ids, 'gone', 'c')).toEqual(['c']);
    expect(idsInRange(ids, 'a', 'gone')).toEqual([]);
  });

  it('selects a range, and un-selects one starting from a selected photo', () => {
    const first = applyClick(new Set(), ids, null, 'b', false);
    expect([...first]).toEqual(['b']);
    const range = applyClick(first, ids, 'b', 'e', true);
    expect([...range].sort()).toEqual(['b', 'c', 'd', 'e']);
    const cleared = applyClick(range, ids, 'e', 'c', true);
    expect([...cleared]).toEqual(['b']);
  });

  it('toggles just one photo without Shift', () => {
    expect([...applyClick(new Set(['a', 'b']), ids, 'a', 'd', false)].sort()).toEqual(['a', 'b', 'd']);
  });
});

describe('the Manage photo grid', () => {
  const grid = codeOnly(readSource('components/AdminPhotoGrid.tsx'));

  it('uses it for both the delete picks and the download-QR picks', () => {
    expect(grid).toContain('onClick={(e) => clickDelete(photo.id, e)}');
    expect(grid).toContain('onClick={(e) => clickShare(photo.id, e)}');
  });

  it('reads the anchor before the state update runs', () => {
    expect(grid).toMatch(/const anchor = deleteAnchor\.current;[\s\S]*?applyClick\(prev, ids, anchor, id, shift\)/);
  });
});
