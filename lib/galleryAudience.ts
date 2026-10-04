/**
 * Who a host lets see their event's gallery, in the words the settings card
 * and the guest pages use.
 *
 * Enforced in amplify/functions/list-event-photos/visibility.ts, which holds
 * the same three keys; __tests__/gallery-audience.test.ts keeps them equal.
 * Nothing here decides access — it only describes it.
 */
export type GalleryAudience = 'everyone' | 'own' | 'host';

export const GALLERY_AUDIENCE_OPTIONS: {
  key: GalleryAudience;
  label: string;
  description: string;
}[] = [
  {
    key: 'everyone',
    label: 'Everyone with the link',
    description: 'Guests see every photo, as they arrive. The usual choice.',
  },
  {
    key: 'own',
    label: 'Each guest sees only their own',
    description:
      'Guests can share as much as they like but only see what they added. Good for work events, events with children, or a memorial.',
  },
  {
    key: 'host',
    label: 'Only you',
    description: 'Guests add photos and never see the gallery. Everything comes straight to you.',
  },
];

export function galleryAudienceFor(
  event: { galleryAudience?: string | null } | null | undefined,
): GalleryAudience {
  const value = event?.galleryAudience;
  return value === 'own' || value === 'host' ? value : 'everyone';
}
