import { boothPersonStatuses, everythingToApprove, photoCount } from '../lib/boothSteps';
import { codeOnly, readSource } from './sourceGuards';

const people = [
  { attendeeId: 'a', name: 'Ann' },
  { attendeeId: 'b', name: 'Bo' },
  { attendeeId: 'c', name: 'Cy' },
];
const a = (attendeeIds: string[], publishStatus: string | null, match = 'divider-time') => ({
  attendeeIds,
  match,
  publishStatus,
});

describe('boothPersonStatuses', () => {
  const assignments = new Map([
    ['p1', a(['a'], 'awaiting_review')],
    ['p2', a(['a'], 'approved')],
    ['p3', a(['b'], 'approved')],
    ['p4', a(['a', 'b'], 'approved')], // group shot
    ['qr', a(['c'], null, 'divider')], // a QR shot never counts
    ['bad', a(['c'], 'rejected')],
  ]);
  const s = boothPersonStatuses(people, assignments);

  it('says Waiting, Ready to approve or Sent', () => {
    expect(s.map((p) => p.state)).toEqual(['ready', 'sent', 'waiting']);
  });
  it('lists what is left to approve, and group shots under everyone', () => {
    expect(s[0].toApprove).toEqual(['p1']);
    expect(s[0].photoIds).toEqual(['p1', 'p2', 'p4']);
    expect(s[1].photoIds).toEqual(['p3', 'p4']);
    expect(s[2].photoIds).toEqual([]);
  });
  it('approves each photo once for "everything"', () => {
    const shared = new Map([['g', a(['a', 'b'], 'awaiting_review')]]);
    expect(everythingToApprove(boothPersonStatuses(people, shared))).toEqual(['g']);
  });
  it('counts in plain words', () => {
    expect(photoCount(1)).toBe('1 photo');
    expect(photoCount(3)).toBe('3 photos');
  });
});

describe('the Booth tab on the dashboard', () => {
  const admin = codeOnly(readSource('pages/event/[eventId]/admin.tsx'));
  const tab = readSource('components/BoothTab.tsx');
  it('is its own tab, shown only while booth mode is on, and deep-linkable', () => {
    expect(admin).toContain("{ id: 'booth', label: 'Booth'");
    expect(admin).toContain("t.id !== 'booth' || boothMode");
    expect(admin).toContain('tabFromQuery(router.query.tab)');
    expect(admin).toContain("activeTab === 'booth' && event?.boothMode !== true ? 'extras'");
  });
  it('keeps the booth UI off Extras, apart from the switch', () => {
    const extras = admin.slice(admin.indexOf('id="extras"'), admin.indexOf('id="booth"'));
    expect(extras).toContain('<BoothModeCard');
    expect(extras).not.toContain('<BoothTab');
  });
  it('asks before emailing everyone', () => {
    expect(tab).toContain('window.confirm(');
    expect(tab).toContain('Approve and send everything');
  });
  it('keeps the photographer path', () => {
    const review = readSource('pages/pro/events/[eventId]/review.tsx');
    expect(review).toContain('BoothFixUp');
    expect(review).toContain('BoothPanel');
  });
});
