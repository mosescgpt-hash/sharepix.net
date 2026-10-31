// Relative imports so this stays importable from the Jest node project.
import { guestLinkPath } from './galleryAccess';

/**
 * Helpers for the live slideshow page and the host's "Share live link" card.
 * Pure, so the rules (what a shared link contains, which fullscreen a browser
 * has, why a screen is empty) are tested without a browser.
 */

/**
 * The path a host shares to put the live slideshow on another screen. It carries
 * the current QR-code key in the fragment when the host has replaced the QR
 * code: without it, anyone opening the link after a replacement is told the link
 * "has been replaced" and sees nothing.
 */
export function liveLinkPath(eventId: string, key: string | null | undefined): string {
  return guestLinkPath(eventId, key, 'live');
}

export function liveLinkUrl(origin: string, eventId: string, key: string | null | undefined): string {
  return `${origin.replace(/\/+$/, '')}${liveLinkPath(eventId, key)}`;
}

/** A mailto: link that sends the live link to the host's own inbox, to open on a computer. */
export function mailtoLiveLink(eventName: string, url: string): string {
  const subject = `Live slideshow: ${eventName}`;
  const body = `Open this on the computer or TV driving the screen:\n\n${url}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// --- Fullscreen --------------------------------------------------------------

type FullscreenDoc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

/**
 * 'native': the standard API (desktop, Android, iPadOS 16.4+).
 * 'webkit': the prefixed API (older Safari, iPadOS).
 * 'none': iPhone Safari, which has no fullscreen for web pages at all. The page
 * offers a "fill the screen" mode instead and points at Add to Home Screen.
 */
export type FullscreenSupport = 'native' | 'webkit' | 'none';

export function fullscreenSupport(doc: Document, el: HTMLElement = doc.documentElement): FullscreenSupport {
  if (doc.fullscreenEnabled && typeof el.requestFullscreen === 'function') return 'native';
  const d = doc as FullscreenDoc;
  const e = el as FullscreenEl;
  if (d.webkitFullscreenEnabled && typeof e.webkitRequestFullscreen === 'function') return 'webkit';
  return 'none';
}

export function isFullscreenNow(doc: Document): boolean {
  const d = doc as FullscreenDoc;
  return Boolean(doc.fullscreenElement || d.webkitFullscreenElement);
}

/** Enter or leave real fullscreen. Resolves false when the browser refused or has none. */
export async function toggleNativeFullscreen(doc: Document, el: HTMLElement = doc.documentElement): Promise<boolean> {
  const support = fullscreenSupport(doc, el);
  if (support === 'none') return false;
  const d = doc as FullscreenDoc;
  const e = el as FullscreenEl;
  try {
    if (isFullscreenNow(doc)) {
      if (support === 'native') await doc.exitFullscreen();
      else await d.webkitExitFullscreen?.();
    } else if (support === 'native') {
      await el.requestFullscreen();
    } else {
      await e.webkitRequestFullscreen?.();
    }
    return true;
  } catch {
    return false;
  }
}

// --- Why is the screen empty? ------------------------------------------------

export type LiveProblem = 'paused' | 'replaced' | 'session' | 'network' | 'timeout' | 'other';

/** Sort a failed poll or start-up error into something the screen can say plainly. */
export function classifyLiveError(error: unknown): LiveProblem {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  if (/SHARING_PAUSED/.test(text)) return 'paused';
  if (/LINK_REQUIRED/.test(text)) return 'replaced';
  if (/timeout|timed out/i.test(text)) return 'timeout';
  if (/credential|no current user|not authorized|unauthorized|identity|token|session/i.test(text)) return 'session';
  if (/network|fetch|offline|connection|load failed/i.test(text)) return 'network';
  return 'other';
}

/** What the viewer is told while polls are failing and nothing is on screen. */
export function connectionMessage(problem: LiveProblem): string {
  switch (problem) {
    case 'session':
      return 'This phone could not start a guest session, so it cannot ask for photos. Reload the page. If it keeps happening, turn off private browsing or open the link in Safari or Chrome instead of inside another app.';
    case 'timeout':
    case 'network':
      return 'Having trouble reaching SharePix. Check the connection; this keeps retrying on its own.';
    default:
      return 'Photos could not be loaded just now. This keeps retrying on its own.';
  }
}

/**
 * What an empty reel should say. `records` is every photo the server returned
 * for the event; `eligible` is what the slideshow may show (approved, still,
 * and past the moderation buffer). When photos exist but none are eligible yet
 * the host would otherwise be told "Waiting for photos", which looks like a bug.
 */
export function emptyReelReason(records: number, eligible: number, videos: number): 'none' | 'buffer' | 'videos-only' {
  if (eligible > 0 || records === 0) return 'none';
  if (videos > 0 && videos === records) return 'videos-only';
  return 'buffer';
}
