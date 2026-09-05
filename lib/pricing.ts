/**
 * Every tier string the product has ever sold. Retired ones stay here forever:
 * an event stamps its tier at creation precisely so a later pricing change
 * cannot retroactively alter what someone already paid for.
 */
export type TierId = 'event' | 'plus' | 'starter' | 'standard' | 'premium';

export interface PricingTier {
  id: TierId;
  name: string;
  price: number;
  photoLimit: number | null; // null = unlimited
  /**
   * How many videos the plan includes. Videos are capped separately from photos
   * because they are the only upload whose cost is not bounded by resizing: a
   * still is shrunk to a 1280px preview before it is ever served, while a video
   * streams from S3 at full size every time someone plays it. Counting videos
   * (rather than bytes) is the unit a host can understand, and the 250 MB
   * per-file ceiling is what bounds the bytes behind it.
   */
  videoLimit: number | null; // null = unlimited
  accessDays: number;
  accessLabel: string;
  // Lifecycle (all measured from when the 30-day upload window closes):
  // how long the HOST keeps full access + downloads before the event archives.
  retentionDays: number;
  // how long GUESTS keep low-resolution viewing before they see nothing.
  guestLowResDays: number;
  features: string[];
  /** Renders the badge on the pricing page. */
  highlight?: boolean;
  /**
   * Whether the host can restyle the event's QR code. A capability flag rather
   * than `tier.id !== 'starter'` scattered across pages: the audit flagged tier
   * strings as load-bearing in five places, and comparing ids is how a new tier
   * silently inherits the wrong behaviour.
   */
  customQrCode: boolean;
  /**
   * No longer sold, but fully understood. Existing events on this tier keep
   * their limits, their retention, and their ability to extend the upload
   * window at the right price.
   */
  retired?: boolean;
}

// The upload window is the same on every plan; it can be extended in 30-day
// blocks for half the plan price.
export const UPLOAD_WINDOW_DAYS = 30;
export const EXTENSION_DAYS = 30;
// After the host-retention period ends, photos sit in a hidden, admin-only
// archive for this long before permanent deletion.
export const ARCHIVE_DAYS = 90;

/**
 * What is on sale today.
 *
 * The lineup moved from Starter $19 / Standard $39 / Premium $79 to
 * Event $39 / Plus $69. Free $0 is deliberately NOT here yet: `paid` currently
 * gates activation, so every live event has a card behind it, and a free tier
 * is the first path to creating storage without one. It ships once there is
 * rate limiting and a retention story to go with it.
 */
const SELLABLE_TIERS: PricingTier[] = [
  {
    id: 'event',
    name: 'Event',
    price: 39,
    photoLimit: 1000,
    videoLimit: 10,
    accessDays: 90,
    accessLabel: '30-day upload window',
    retentionDays: 90,
    guestLowResDays: 30,
    customQrCode: true,
    features: [
      'Up to 1,000 photos and 10 videos',
      '30-day upload window (extend +30 days anytime)',
      'Guests view 30 days after uploads close; host access 3 months',
      'Customizable QR code',
      'Host individual and bulk ZIP downloads',
      'Guests can download the photos too — full resolution, no account',
      'Uploader names on photos',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    price: 69,
    // A real number rather than "unlimited". The old Premium tier advertised
    // unlimited photos, which is an unbounded storage and egress bill on a
    // one-off payment. Events already sold as Premium keep unlimited — they
    // were sold that — but nothing new promises it.
    photoLimit: 3000,
    videoLimit: 30,
    accessDays: 365,
    accessLabel: '30-day upload window',
    retentionDays: 365,
    guestLowResDays: 30,
    customQrCode: true,
    // Badged "Best value" rather than "Most popular": it folds in $48 of
    // add-ons for $30 more than Event, which is checkable, whereas nothing has
    // sold yet so popularity would be invented.
    highlight: true,
    features: [
      'Up to 3,000 photos and 30 videos',
      '30-day upload window (extend +30 days anytime)',
      'Guests view 30 days after uploads close; host access 1 year',
      'Customizable QR code',
      'Event branding',
      'Moderation tools (approve before showing)',
      'Guest book included — signed notes, photos, and video messages',
      'Live slideshow included — a venue screen showing photos as they arrive',
      'Host photo, video, and bulk ZIP downloads',
      'Guests can download the photos too — full resolution, no account',
    ],
  },
];

/**
 * Retired plans. NOT on sale, NOT removed.
 *
 * Every one of these is still stamped on live event rows, and dropping them
 * would be silent and expensive: `videoLimitForTier` falls through to `null`
 * for an unknown tier, and null means *unlimited*; `extensionPrice` falls back
 * to $10 regardless of what the host actually paid. Both are wrong in the
 * customer's favour or ours, and neither errors.
 */
const RETIRED_TIERS: PricingTier[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 19,
    photoLimit: 100,
    videoLimit: 2,
    accessDays: 14,
    accessLabel: '30-day upload window',
    retentionDays: 21,
    guestLowResDays: 21,
    customQrCode: false,
    retired: true,
    features: [
      'Up to 100 photos and 2 videos',
      '30-day upload window (extend +30 days anytime)',
      'Guests view 3 weeks after uploads close; host access 3 weeks',
      'Standard QR code',
      'Host individual and bulk ZIP downloads (sign-in required)',
      'Guests can download the photos too — full resolution, no account',
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    price: 39,
    photoLimit: 1000,
    videoLimit: 10,
    accessDays: 90,
    accessLabel: '30-day upload window',
    retentionDays: 90,
    guestLowResDays: 30,
    customQrCode: true,
    retired: true,
    features: [
      'Up to 1,000 photos and 10 videos',
      '30-day upload window (extend +30 days anytime)',
      'Guests view 30 days after uploads close; host access 3 months',
      'Customizable QR code',
      'Host individual and bulk ZIP downloads',
      'Guests can download the photos too — full resolution, no account',
      'Uploader names on photos',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    // Unlimited, permanently, for the events that bought it.
    price: 79,
    photoLimit: null,
    videoLimit: 30,
    accessDays: 365,
    accessLabel: '30-day upload window',
    retentionDays: 365,
    guestLowResDays: 30,
    customQrCode: true,
    retired: true,
    features: [
      'Unlimited photos and 30 videos',
      '30-day upload window (extend +30 days anytime)',
      'Guests view 30 days after uploads close; host access 1 year',
      'Customizable QR code',
      'Event branding',
      'Moderation tools (approve before showing)',
      'Guest book — signed notes, photos, and video messages',
      'Host photo, video, and bulk ZIP downloads',
      'Guests can download the photos too — full resolution, no account',
    ],
  },
];

/** What the pricing page and the create-event form offer. Sellable only. */
export const PRICING_TIERS: PricingTier[] = SELLABLE_TIERS;

/** Every tier ever sold, for interpreting an event that already exists. */
export const ALL_TIERS: PricingTier[] = [...SELLABLE_TIERS, ...RETIRED_TIERS];

export const CORPORATE_PLAN = {
  name: 'Corporate',
  price: 149, // USD per month
  interval: 'month' as const,
  priceLabel: '$149 / month',
  // Lifecycle for events created under a Corporate subscription (premium-like:
  // unlimited photos, 1-year host retention, 30-day guest low-res).
  retentionDays: 365,
  guestLowResDays: 30,
  // Photos are unlimited on corporate events, videos are not — see PricingTier.
  videoLimit: 30,
  accessLabel: 'Multiple events under one account',
  features: [
    'Multiple active events',
    'Unlimited photos and 30 videos per event',
    'Central event and storage dashboard',
    'Custom company branding',
    'Guest book — signed notes, photos, and video messages',
    'Host and bulk ZIP downloads',
    'Guests can download the photos too — full resolution, no account',
    '30 days to download after your last paid month',
    'Priority support',
  ],
};

/**
 * One-time cost to turn on the live slideshow for a single event. Sold on every
 * plan, not just Corporate — it's the marquee wedding feature and the main
 * reason a couple upgrades, so gating it by tier would cost more sales than it
 * protects.
 */
export const LIVE_SLIDESHOW_ADDON_PRICE = 29;

/**
 * One-time cost to add a guest book to a single event, on the plans that do not
 * already include it — Event, and the retired Starter and Standard. See
 * lib/guestBook.ts.
 *
 * Priced under the Event-to-Plus gap on purpose: at $19 an Event host pays $58
 * all-in rather than $69 to upgrade, so the add-on stays the cheaper answer for
 * someone who wants the guest book and nothing else Plus offers.
 */
export const GUEST_BOOK_ADDON_PRICE = 19;

/**
 * Look up any tier an event might carry, retired ones included.
 *
 * This searches ALL_TIERS, never PRICING_TIERS. Everything that decides what an
 * existing event is entitled to goes through here, so retiring a plan changes
 * what can be bought and nothing else.
 */
export function getTier(id: string): PricingTier | undefined {
  return ALL_TIERS.find((t) => t.id === id);
}

/** Whether this tier can still be bought. The pricing page's question. */
export function isSellableTier(id: string): boolean {
  return SELLABLE_TIERS.some((t) => t.id === id);
}

/**
 * Plans that include the live slideshow at no extra cost, mirroring
 * GUEST_BOOK_INCLUDED_TIERS in lib/guestBook.ts. Plus folds in both add-ons,
 * which is most of why it is $10 cheaper than the Premium it replaces and
 * still better value.
 */
export const LIVE_SLIDESHOW_INCLUDED_TIERS = ['plus', 'corporate'] as const;

/**
 * Whether an event can run the live slideshow: the host bought the add-on, or
 * their plan includes it. Same shape as guestBookAvailable, deliberately.
 */
export function liveSlideshowAvailable(event: {
  tier?: string | null;
  liveSlideshowEnabled?: boolean | null;
} | null | undefined): boolean {
  if (!event) return false;
  if (event.liveSlideshowEnabled === true) return true;
  const tier = (event.tier ?? '').toLowerCase();
  return (LIVE_SLIDESHOW_INCLUDED_TIERS as readonly string[]).includes(tier);
}

/**
 * Videos an event can still accept, or null when it has no limit. Used to tell
 * a guest before they pick a file; the real enforcement is the atomic
 * reservation in create-event-photo, which this only mirrors.
 */
export function videosRemaining(event: {
  videoLimit?: number | null;
  extraVideoCredits?: number | null;
  videoCount?: number | null;
}): number | null {
  if (event.videoLimit == null) return null; // pre-limit event, or unlimited
  const limit = event.videoLimit + (event.extraVideoCredits ?? 0);
  return Math.max(0, limit - (event.videoCount ?? 0));
}

/**
 * How many videos a new event on this tier includes, stamped onto the event at
 * creation so a later pricing change never retroactively blocks uploads to an
 * event someone already paid for.
 *
 * Corporate has no PricingTier row, so it is handled explicitly rather than
 * falling through to null — null means *unlimited*, which is exactly what a
 * video limit must never become by accident.
 */
export function videoLimitForTier(id: string): number | null {
  const tier = getTier(id);
  if (tier) return tier.videoLimit;
  return id === 'corporate' ? CORPORATE_PLAN.videoLimit : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Price to extend the upload window by 30 days: half the plan price (min $1). */
export function extensionPrice(tierId: string): number {
  const tier = getTier(tierId);
  return Math.max(1, Math.round((tier?.price ?? 20) / 2));
}

/**
 * Apply a percentage discount to a price, rounded to whole cents. `percentOff`
 * is clamped to 0–100, so 100 makes the price $0 (a fully comped purchase) and
 * anything out of range can't produce a negative or inflated total. This is the
 * display-side mirror of the discount the stripe-checkout function applies as a
 * Stripe coupon, so the price a host sees matches what they're charged.
 */
export function applyPercentOff(price: number, percentOff: number): number {
  const pct = Math.min(100, Math.max(0, percentOff));
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}

/**
 * Price after a discount code, for display. Mirrors what the checkout function
 * asks Stripe to charge, so the figure a host sees matches their card.
 *
 * A fixed amount is capped at the price (never negative) and rounded up to
 * cover the whole thing when the remainder would be too small for Stripe to
 * charge — the same rule the server applies.
 */
export function applyDiscount(
  price: number,
  discount: {
    discountType?: string | null;
    percentOff?: number | null;
    amountOffCents?: number | null;
  },
): number {
  if (discount.discountType === 'amount') {
    const off = Math.max(0, (discount.amountOffCents ?? 0) / 100);
    const remaining = Math.round((price - off) * 100) / 100;
    if (remaining <= 0 || remaining < 0.5) return 0;
    return remaining;
  }
  return applyPercentOff(price, discount.percentOff ?? 0);
}

/** When the initial 30-day upload window closes for a new event. */
export function computeUploadWindowEndsAt(from: Date = new Date()): string {
  return new Date(from.getTime() + UPLOAD_WINDOW_DAYS * DAY_MS).toISOString();
}

/** Compute the gallery expiry timestamp for a tier, starting now. */
export function computeAccessExpiresAt(tierId: string, from: Date = new Date()): string {
  const tier = getTier(tierId);
  // Corporate events (no per-event tier row) get the full upload window + host
  // retention so the displayed access date isn't the 14-day fallback.
  const days = tier
    ? tier.accessDays
    : tierId === 'corporate'
      ? UPLOAD_WINDOW_DAYS + CORPORATE_PLAN.retentionDays
      : 14;
  const expires = new Date(from.getTime() + days * DAY_MS).toISOString();
  return expires;
}
