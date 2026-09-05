/**
 * Which quick-start sections the host guide shows for an event.
 *
 * Pure so the ordering and the "only when the slideshow is bought" rule can be
 * tested without rendering. The component (components/HostGuide.tsx) turns each
 * id into copy plus the event's real links.
 */

// Relative, not `@/`: this module is covered by the node test project, which
// deliberately has no path alias so a moved file cannot be masked by one.
import { liveSlideshowAvailable } from './pricing';

export type HostGuideSection = 'upload' | 'brochure' | 'live' | 'downloads';

export function hostGuideSections(event: {
  tier?: string | null;
  liveSlideshowEnabled?: boolean | null;
  guestDownloadEnabled?: boolean | null;
}): HostGuideSection[] {
  const sections: HostGuideSection[] = ['upload', 'brochure'];
  // Only guide the host through running the slideshow once they actually have
  // it — included on their plan, or bought as an add-on — or the steps point at
  // a page they can't open.
  if (liveSlideshowAvailable(event)) sections.push('live');
  // Same for guest downloads: only relevant once enabled.
  // Guest downloads ship with every plan now, so the how-to always applies.
  sections.push('downloads');
  return sections;
}
