import { DASHBOARD_JUMPS, jumpByKey, jumpsFor } from '../lib/dashboardJumps';
import { codeOnly, readSource } from './sourceGuards';

/**
 * "I want to…" is only useful if every entry lands somewhere. These read the
 * dashboard source for each target, and check it sits in the tab it opens.
 */
const ADMIN = codeOnly(readSource('pages/event/[eventId]/admin.tsx'));
const TAB_ORDER = ['share', 'photos', 'design', 'guests', 'extras', 'event'];
const ALL = DASHBOARD_JUMPS.flatMap((g) => g.jumps);

describe('the I want to… list', () => {
  it.each(ALL.map((j) => [j.key, j]))('%s lands on a card in its tab', (_key, jump) => {
    const target = ADMIN.indexOf(`id="${jump.target}"`);
    expect({ target: jump.target, found: target >= 0 }).toEqual({ target: jump.target, found: true });
    const start = ADMIN.indexOf(`id="${jump.tab}"`);
    const nextTab = TAB_ORDER[TAB_ORDER.indexOf(jump.tab) + 1];
    const end = nextTab ? ADMIN.indexOf(`id="${nextTab}"`) : ADMIN.length;
    expect({ jump: jump.key, inTab: target > start && target < end }).toEqual({
      jump: jump.key,
      inTab: true,
    });
  });

  it('has unique keys', () => {
    expect(new Set(ALL.map((j) => j.key)).size).toBe(ALL.length);
  });

  it('only opens Look and feel tabs that exist', () => {
    const tabs = codeOnly(readSource('components/GalleryStyleSettings.tsx'));
    for (const jump of ALL.filter((j) => j.lookTab)) {
      expect(tabs).toContain(`key: '${jump.lookTab}'`);
    }
  });

  it('drops entries whose card is not on the page', () => {
    const off = jumpsFor({ commentsOn: false, featuredOffered: false }).flatMap((g) => g.jumps);
    expect(off.map((j) => j.key)).not.toContain('comments');
    expect(off.map((j) => j.key)).not.toContain('featured');
    const on = jumpsFor({ commentsOn: true, featuredOffered: true }).flatMap((g) => g.jumps);
    expect(on.map((j) => j.key)).toEqual(expect.arrayContaining(['comments', 'featured']));
  });

  it('finds entries by key', () => {
    expect(jumpByKey('cover')?.lookTab).toBe('cover');
    expect(jumpByKey('nope')).toBeNull();
  });
});
