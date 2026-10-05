/**
 * One-click looks for a host who does not want to design anything.
 *
 * Each one is a font set, an accent colour and a cover background that go
 * together, chosen from the same validated lists the individual controls use —
 * so a look is only a shortcut, never a fourth kind of setting. Picking one
 * leaves a host's own cover photo in place: the background only shows when
 * there is no photo.
 */
export interface StarterLook {
  key: string;
  label: string;
  /** Who it suits, in a few words. */
  description: string;
  galleryFontSet: string;
  /** '' for the SharePix palette. */
  galleryAccent: string;
  coverPreset: string;
}

export const STARTER_LOOKS: StarterLook[] = [
  // The most professional of the set, and the fallback for any event type
  // without a better fit: serif headings over a plain body (the pairing
  // editorial and brand sites use), a deep midnight cover and one restrained
  // navy accent. Nothing about it says "template".
  {
    key: 'signature',
    label: 'Signature',
    description: 'Polished and professional',
    galleryFontSet: 'classic',
    galleryAccent: '#24395c',
    coverPreset: 'midnight',
  },
  {
    key: 'sharepix',
    label: 'SharePix',
    description: 'Clean and modern',
    galleryFontSet: 'sharepix',
    galleryAccent: '',
    coverPreset: 'navy',
  },
  {
    key: 'romantic',
    label: 'Romantic',
    description: 'Weddings, anniversaries',
    galleryFontSet: 'elegant',
    galleryAccent: '#a14a63',
    coverPreset: 'rose',
  },
  {
    key: 'ivory',
    label: 'Ivory',
    description: 'Elegant weddings, black tie',
    galleryFontSet: 'elegant',
    galleryAccent: '#7d6234',
    coverPreset: 'ivory',
  },
  {
    key: 'linen',
    label: 'Linen',
    description: 'Classic, soft and warm',
    galleryFontSet: 'classic',
    galleryAccent: '#5b4a3a',
    coverPreset: 'cream',
  },
  {
    key: 'garden',
    label: 'Garden',
    description: 'Outdoor, rustic, spring',
    galleryFontSet: 'classic',
    galleryAccent: '#557560',
    coverPreset: 'sage',
  },
  {
    key: 'golden',
    label: 'Golden hour',
    description: 'Formal dinners, galas',
    galleryFontSet: 'statement',
    galleryAccent: '#a07b3f',
    coverPreset: 'champagne',
  },
  {
    key: 'party',
    label: 'Party',
    description: 'Birthdays, reunions',
    galleryFontSet: 'sharepix',
    galleryAccent: '#c2410c',
    coverPreset: 'confetti',
  },
  {
    key: 'coastal',
    label: 'Coastal',
    description: 'Beach, summer, travel',
    galleryFontSet: 'classic',
    galleryAccent: '#16657a',
    coverPreset: 'ocean',
  },
];

export function starterLookFor(key: string | null | undefined): StarterLook | null {
  return STARTER_LOOKS.find((l) => l.key === key) ?? null;
}
