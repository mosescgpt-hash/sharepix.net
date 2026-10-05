/**
 * "I want to…" on the event dashboard: a plain list of the things hosts come
 * to change, each one taking them to the tab and the card that does it.
 *
 * Six tabs are easy to scan, but a host who wants to "turn off downloads"
 * should not have to guess that it lives under Guests. The list is in the
 * host's words, grouped by the tab it opens so it also teaches the layout.
 *
 * `target` is the id of an element on the dashboard; `lookTab` also opens
 * that tab inside Look and feel. `when` hides an entry whose card is not on the
 * page for this event, so the list never leads nowhere.
 */

export type DashboardTab = 'share' | 'photos' | 'design' | 'guests' | 'extras' | 'event';
export type LookTab = 'looks' | 'cover' | 'fonts' | 'gallery' | 'custom';

/** Facts about the event that decide whether a card is on the page. */
export interface JumpConditions {
  commentsOn: boolean;
  featuredOffered: boolean;
}

export interface DashboardJump {
  key: string;
  label: string;
  tab: DashboardTab;
  target: string;
  lookTab?: LookTab;
  when?: (c: JumpConditions) => boolean;
}

export interface DashboardJumpGroup {
  label: string;
  jumps: DashboardJump[];
}

export const DASHBOARD_JUMPS: DashboardJumpGroup[] = [
  {
    label: 'Share',
    jumps: [
      { key: 'qr', label: 'Get or style my QR code', tab: 'share', target: 'event-qr-code' },
      { key: 'print', label: 'Print signs or a table tent', tab: 'share', target: 'printables' },
      { key: 'moments', label: 'Add a QR code for part of the day', tab: 'share', target: 'moments' },
    ],
  },
  {
    label: 'Photos',
    jumps: [
      { key: 'photos', label: 'See, hide or remove photos', tab: 'photos', target: 'photo-grid' },
      {
        key: 'comments',
        label: 'Review comments',
        tab: 'photos',
        target: 'comments',
        when: (c) => c.commentsOn,
      },
      { key: 'download-link', label: 'Share a download link', tab: 'photos', target: 'download-share' },
    ],
  },
  {
    label: 'Design',
    jumps: [
      { key: 'look', label: 'Pick a look', tab: 'design', target: 'look-and-feel', lookTab: 'looks' },
      { key: 'cover', label: 'Change the cover photo', tab: 'design', target: 'look-and-feel', lookTab: 'cover' },
      { key: 'fonts', label: 'Change the fonts', tab: 'design', target: 'look-and-feel', lookTab: 'fonts' },
      {
        key: 'layout',
        label: 'Change the layout, likes or who can see the gallery',
        tab: 'design',
        target: 'look-and-feel',
        lookTab: 'gallery',
      },
      {
        key: 'headline',
        label: 'Edit the headline or colour',
        tab: 'design',
        target: 'look-and-feel',
        lookTab: 'custom',
      },
    ],
  },
  {
    label: 'Guests',
    jumps: [
      { key: 'audience', label: 'Change who adds the photos', tab: 'guests', target: 'guest-settings' },
      { key: 'screening', label: 'Screen photos before they appear', tab: 'guests', target: 'photo-screening' },
      { key: 'downloads', label: 'Turn guest downloads on or off', tab: 'guests', target: 'guest-downloads' },
      { key: 'videos', label: 'Turn guest videos on or off', tab: 'guests', target: 'guest-videos' },
      { key: 'reminders', label: 'Send guests upload reminders', tab: 'guests', target: 'reminders' },
      { key: 'challenges', label: 'Set photo challenges', tab: 'guests', target: 'challenges' },
    ],
  },
  {
    label: 'Extras',
    jumps: [
      { key: 'photographer', label: 'Add my photographer', tab: 'extras', target: 'photographer' },
      { key: 'addons', label: 'Add a slideshow or more time', tab: 'extras', target: 'addons' },
      {
        key: 'featured',
        label: 'Feature this event',
        tab: 'extras',
        target: 'featured',
        when: (c) => c.featuredOffered,
      },
    ],
  },
  {
    label: 'Event',
    jumps: [
      { key: 'details', label: 'Change the name, date or place', tab: 'event', target: 'event-details' },
      { key: 'close', label: 'Close uploads or delete the event', tab: 'event', target: 'ending' },
    ],
  },
];

/** The groups as this event should see them: entries without a card dropped. */
export function jumpsFor(conditions: JumpConditions): DashboardJumpGroup[] {
  return DASHBOARD_JUMPS.map((group) => ({
    ...group,
    jumps: group.jumps.filter((j) => !j.when || j.when(conditions)),
  })).filter((group) => group.jumps.length > 0);
}

export function jumpByKey(key: string): DashboardJump | null {
  for (const group of DASHBOARD_JUMPS) {
    const found = group.jumps.find((j) => j.key === key);
    if (found) return found;
  }
  return null;
}
