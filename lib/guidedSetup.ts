/**
 * Guided customization: a walk through the event dashboard's options, one at
 * a time, for a host who isn't sure what they want yet.
 *
 * Each step opens the card that does it (a DASHBOARD_JUMPS key, so the guide
 * and "I want to…" can't disagree about where anything lives) and says in one
 * or two sentences what the choice is and what most hosts pick. Nothing here
 * changes a setting: the host still decides on the card itself.
 *
 * Pure, so the order and the filtering are tested without rendering.
 */

// Relative, not `@/`: covered by the node test project, which has no alias.
import { jumpByKey, type JumpConditions } from './dashboardJumps';

export interface GuideStep {
  /** A DASHBOARD_JUMPS key: the card this step opens. */
  jump: string;
  title: string;
  /** What the choice is, in the host's words, and the usual answer. */
  why: string;
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    jump: 'qr',
    title: 'Your QR code',
    why: 'This is what guests scan to add photos. Change its colour or add your logo if you like; the plain one works just as well.',
  },
  {
    jump: 'look',
    title: 'Pick a look',
    why: 'A ready-made style for your event pages and gallery. Tap one to preview it. You can fine-tune it in the next few steps or leave it.',
  },
  {
    jump: 'cover',
    title: 'Cover photo',
    why: 'The picture across the top of your event pages. A favourite photo of the couple, the venue or your logo works well.',
  },
  {
    jump: 'layout',
    title: 'Gallery layout and privacy',
    why: 'How photos are laid out, whether guests can like them, and who can see the gallery. Most hosts let every guest see everything.',
  },
  {
    jump: 'audience',
    title: 'Who adds the photos',
    why: 'Usually your guests. Choose host-only if you want to be the only one uploading.',
  },
  {
    jump: 'screening',
    title: 'Screen photos first',
    why: 'Every photo is checked for explicit content. Choose whether anything flagged waits for your OK (the default) or everything appears straight away.',
  },
  {
    jump: 'downloads',
    title: 'Guest downloads',
    why: 'Whether guests can save the photos at full resolution. On by default; turn it off if you would rather the pictures stayed with you.',
  },
  {
    jump: 'videos',
    title: 'Guest videos',
    why: 'On by default. Guests can upload videos, but only you can watch them. Turn them off if you only want photos.',
  },
  {
    jump: 'reminders',
    title: 'Upload reminders',
    why: 'After a guest\'s first upload, offer to email them a reminder to add more, so the photos still on their phones make it in.',
  },
  {
    jump: 'challenges',
    title: 'Photo challenges',
    why: 'Optional prompts like "a photo with the oldest guest". A fun way to get more photos; skip it if it is not your style.',
  },
  {
    jump: 'photographer',
    title: 'Your photographer',
    why: 'If you have hired a photographer, invite them here and their shots appear in the same gallery. Booth mode for headshots is just below.',
  },
  {
    jump: 'print',
    title: 'Signs and table tents',
    why: 'Printable signs with your QR code for tables and the entrance. The easiest way to make sure guests know to scan.',
  },
];

/** The steps for this event: any whose card isn't on its dashboard dropped. */
export function guideStepsFor(conditions: JumpConditions): GuideStep[] {
  return GUIDE_STEPS.filter((step) => {
    const jump = jumpByKey(step.jump);
    return jump !== null && (!jump.when || jump.when(conditions));
  });
}

/** Where a host is in the guide, kept per event on their own device. */
export type GuideProgress =
  | { status: 'unseen' }
  | { status: 'active'; step: number }
  | { status: 'done' }
  | { status: 'dismissed' };

/** A stored value read back safely: anything unexpected is "unseen". */
export function readGuideProgress(raw: string | null, stepCount: number): GuideProgress {
  if (!raw) return { status: 'unseen' };
  try {
    const value = JSON.parse(raw) as { status?: unknown; step?: unknown };
    if (value.status === 'done' || value.status === 'dismissed') return { status: value.status };
    if (value.status === 'active' && typeof value.step === 'number' && Number.isInteger(value.step)) {
      return { status: 'active', step: Math.min(Math.max(value.step, 0), Math.max(stepCount - 1, 0)) };
    }
  } catch {
    // fall through
  }
  return { status: 'unseen' };
}

export function guideStorageKey(eventId: string): string {
  return `spx-guide:${eventId}`;
}
