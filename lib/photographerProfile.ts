import {
  DEFAULT_PREVIEW_LONG_EDGE,
  MAX_PREVIEW_LONG_EDGE,
  MIN_PREVIEW_LONG_EDGE,
  previewLongEdge,
} from './professionalMedia';

/**
 * What a photographer can set about themselves on /pro/profile.
 *
 * Every field here was already read by process-pro-photo — the name, the three
 * links, the watermark and the preview size are stamped onto each photo as it
 * is processed — but nothing let a photographer set them, so every gallery tile
 * went out with no credit, no links and no watermark. This is that form.
 *
 * Because the values are stamped at processing time, a change applies to
 * photos uploaded from then on, not to ones already in a gallery. The page says
 * so; it is the question a photographer will have.
 */
export interface PhotographerProfileForm {
  businessName: string;
  website: string;
  contactUrl: string;
  purchaseGalleryUrl: string;
  watermarkEnabled: boolean;
  watermarkText: string;
  previewLongEdge: number;
  keepOriginals: boolean;
}

export const EMPTY_PROFILE: PhotographerProfileForm = {
  businessName: '',
  website: '',
  contactUrl: '',
  purchaseGalleryUrl: '',
  watermarkEnabled: false,
  watermarkText: '',
  previewLongEdge: DEFAULT_PREVIEW_LONG_EDGE,
  keepOriginals: false,
};

/** The preview sizes offered, small to large, all inside the supported range. */
export const PREVIEW_SIZE_OPTIONS: readonly number[] = [1200, 1500, 1800, 2100, 2400].filter(
  (n) => n >= MIN_PREVIEW_LONG_EDGE && n <= MAX_PREVIEW_LONG_EDGE,
);

/** Longest name or watermark accepted; the watermark itself is cut at 60. */
export const MAX_NAME_LENGTH = 80;
export const MAX_WATERMARK_LENGTH = 60;

/** The three link fields, with what each is for, in the order they appear. */
export const LINK_FIELDS: ReadonlyArray<{
  key: 'website' | 'contactUrl' | 'purchaseGalleryUrl';
  label: string;
  hint: string;
}> = [
  {
    key: 'purchaseGalleryUrl',
    label: 'Where guests buy prints',
    hint: 'Shown as “Purchase photo” on each of your shots.',
  },
  { key: 'website', label: 'Your website', hint: 'Shown as “View photographer”.' },
  {
    key: 'contactUrl',
    label: 'Contact or booking page',
    hint: 'Shown as “Contact photographer”.',
  },
];

/**
 * A link as it will be saved: trimmed, with https:// added to a bare domain,
 * or null when it cannot be a safe link. Empty is fine and saves as empty.
 *
 * The gallery renders only http(s) links (galleryLinksFor), so anything else
 * is refused here rather than saved and silently dropped later.
 */
export function normalizeLink(raw: string): string | null {
  let value = raw.trim();
  if (!value) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname.includes('.')) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * The form cleaned up for saving, or the problems that stop it saving.
 * Problems are keyed by field so the page can show each beside its box.
 */
export function prepareProfile(form: PhotographerProfileForm):
  | { ok: true; value: PhotographerProfileForm }
  | { ok: false; problems: Partial<Record<keyof PhotographerProfileForm, string>> } {
  const problems: Partial<Record<keyof PhotographerProfileForm, string>> = {};
  const businessName = form.businessName.trim();
  if (businessName.length > MAX_NAME_LENGTH) {
    problems.businessName = `Keep it under ${MAX_NAME_LENGTH} characters.`;
  }
  const links = {} as Record<'website' | 'contactUrl' | 'purchaseGalleryUrl', string>;
  for (const field of LINK_FIELDS) {
    const link = normalizeLink(form[field.key]);
    if (link === null) problems[field.key] = 'That does not look like a web address.';
    else links[field.key] = link;
  }
  const watermarkText = form.watermarkText.trim();
  if (watermarkText.length > MAX_WATERMARK_LENGTH) {
    problems.watermarkText = `Keep it under ${MAX_WATERMARK_LENGTH} characters.`;
  }
  if (form.watermarkEnabled && !watermarkText && !businessName) {
    problems.watermarkText = 'Add the text to show, or a business name above to use instead.';
  }
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      ...form,
      businessName,
      ...links,
      watermarkText,
      previewLongEdge: previewLongEdge(form.previewLongEdge),
    },
  };
}
