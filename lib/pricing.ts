/**
 * Every tier string the product has ever sold. Retired ones stay here forever:
 * an event stamps its tier at creation precisely so a later pricing change
 * cannot retroactively alter what someone already paid for.
 */
export type TierId = 'free' | 'plus' | 'event' | 'starter' | 'standard' | 'premium';

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
  // Lifecycle (all measured from when the upload window closes):
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
  /**
   * A trial rather than a purchase: nothing has been paid, so nothing may be
   * sold against it. A trial event cannot buy add-ons, cannot extend its
   * upload window, and can never reach Stripe at all — `extensionPrice` on a
   * $0 plan would otherwise arrive at a $1 extension, which is not a price
   * anyone decided on. It is also the only tier limited per ACCOUNT rather
   * than per event; see FreeEventClaim in amplify/data/resource.ts.
   */
  trial?: boolean;
}

/**
 * The upload window is the same on every plan; it can be extended in 30-day
 * blocks for half the plan price.
 *
 * Sixty days, not thirty. A guest who took photos at a wedding does not empty
 * their camera roll the same month, and the single most common way this product
 * fails is a window that closed before the person with the good photos got
 * round to it. Only NEW events are affected: `uploadWindowEndsAt` is stamped on
 * the row at creation, so every existing event keeps the window it was sold.
 */
export const UPLOAD_WINDOW_DAYS = 60;
export const EXTENSION_DAYS = 30;

/**
 * How long the gallery stays up after the upload window closes — for guests at
 * reduced resolution, and for the host at full access with downloads.
 *
 * One number for every plan on sale. Retention used to be a tier
 * differentiator (3 weeks / 3 months / 1 year), which made the single most
 * important sentence on the site — how long do I keep my photos — impossible to
 * say without a table. It now says twelve months and means it on everything
 * sold today. Plans differ on capacity and features instead.
 *
 * Measured from the window closing rather than from creation, because that is
 * the anchor every other lifecycle date already uses. The customer-facing
 * promise is "twelve months"; what they actually get is the window plus twelve
 * months, so the promise is met early rather than missed by a rounding
 * argument about when an event "started".
 */
export const GALLERY_MONTHS = 12;
const GALLERY_DAYS = 365;
// After the host-retention period ends, photos sit in a hidden, admin-only
// archive for this long before permanent deletion.
export const ARCHIVE_DAYS = 90;

/**
 * What is on sale today.
 *
 * The lineup went Starter/Standard/Premium → Event $39 / Plus $89 → this: one
 * free trial and one paid plan. Two paid plans differing on capacity asked a
 * host to predict how many photos an event that has not happened yet would
 * produce, which nobody can do; faced with an unevaluable difference people
 * take the cheaper one, so the split did not price-discriminate, it just
 * discounted. One plan with everything in it, and a free event to try it with,
 * is the whole lineup.
 *
 * The paid plan keeps the tier id `plus` rather than taking over `event`. That
 * looks odd until you remember what the ids mean: `plus` has always been the
 * all-in plan — it is already in GUEST_BOOK_INCLUDED_TIERS and
 * LIVE_SLIDESHOW_INCLUDED_TIERS — so this is a price cut on a plan whose
 * meaning does not change. Redefining `event` to mean $79-with-everything
 * would rewrite an id that an unpaid event row could be carrying right now,
 * and that host would owe $79 having been quoted $39. For an event that
 * already exists, a price may only ever move down.
 */
const SELLABLE_TIERS: PricingTier[] = [
  {
    id: 'free',
    // "Free event", not "Free": the card renders the plan name as an eyebrow
    // above the price, and a plan called Free priced at Free reads as a
    // rendering bug rather than a plan.
    name: 'Free event',
    price: 0,
    trial: true,
    // Enough to run a small real event and watch it work, which is the point;
    // not enough to be a plan someone lives on. The cap is the upgrade prompt.
    photoLimit: 50,
    // One, not none. A host who never sees video work does not know the paid
    // plan does it — and video is the one upload whose cost is not bounded by
    // resizing, so this is the number that has to stay small.
    videoLimit: 1,
    // The same 60-day upload window as the paid plan, then a 30-day gallery
    // rather than twelve months. The window is what makes the product work at
    // an event; the twelve months is a large part of what people pay for.
    accessDays: UPLOAD_WINDOW_DAYS + 30,
    accessLabel: '60-day upload window',
    retentionDays: 30,
    guestLowResDays: 30,
    customQrCode: false,
    features: [
      'One free event per account',
      'Up to 50 photos and 1 video',
      '60-day upload window',
      'Gallery stays up for 30 days after uploads close',
      'Host and guest downloads — full resolution, no account',
    ],
  },
  {
    id: 'plus',
    // Displayed as "Event" because it is the only plan; the id stays `plus`
    // for the reason above. The retired $39 tier below is the one that was
    // called Event, so its display name is disambiguated rather than its id.
    name: 'Event',
    price: 79,
    // Unlimited, and meant.
    //
    // This was 3,000, with a comment arguing that "unlimited" on a one-time
    // payment is an unbounded storage and egress bill. That argument was right
    // and is now answered rather than ignored: storage is measured per event,
    // media is deleted at the end of the archive window instead of being kept
    // forever, and fair-use thresholds make an abnormal event visible. The
    // liability is bounded by retention now, not by a number a host has to
    // count against.
    //
    // What made 3,000 wrong as a customer promise is that nobody can predict
    // how many photos an event that has not happened yet will produce, so the
    // number could only ever be reassuring or alarming by accident.
    //
    // See lib/fairUse.ts for what stops abuse, and lib/storageReclaim.ts for
    // what stops it being forever.
    photoLimit: null,
    // Video is NOT unlimited and is not advertised as such. It is the one
    // upload whose cost is not bounded by resizing — a clip streams at full
    // size on every play — and the brief is explicit that a customer-facing
    // video allowance should not be set before real usage and cost data exist.
    // There is none yet. When there is, the honest unit is gigabytes rather
    // than a count, because video sizes vary by an order of magnitude.
    videoLimit: 30,
    accessDays: UPLOAD_WINDOW_DAYS + GALLERY_DAYS,
    accessLabel: '60-day upload window',
    retentionDays: GALLERY_DAYS,
    guestLowResDays: GALLERY_DAYS,
    customQrCode: true,
    // The plan, rather than a plan. No badge text is set on the card any more:
    // with one paid plan there is nothing to be better value than, and
    // "Best value" against a free trial would be an odd thing to claim.
    highlight: true,
    features: [
      'Unlimited photos, and up to 30 videos',
      'Unlimited guests — no app, no accounts',
      '60-day upload window (extend +30 days anytime)',
      'Gallery stays up for 12 months after uploads close',
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
    // The $39 tier from the two-plan lineup, retired at exactly what it was
    // sold for. Its window is 60 days because that change was global and
    // applied to every event; everything else here is what a buyer was shown.
    id: 'event',
    name: 'Event (original)',
    price: 39,
    photoLimit: 1000,
    videoLimit: 10,
    accessDays: UPLOAD_WINDOW_DAYS + GALLERY_DAYS,
    accessLabel: '60-day upload window',
    retentionDays: GALLERY_DAYS,
    guestLowResDays: GALLERY_DAYS,
    customQrCode: true,
    retired: true,
    features: [
      'Up to 1,000 photos and 10 videos',
      '60-day upload window (extend +30 days anytime)',
      'Gallery stays up for 12 months after uploads close',
      'Customizable QR code',
      'Host individual and bulk ZIP downloads',
      'Guests can download the photos too — full resolution, no account',
      'Uploader names on photos',
    ],
  },
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
 * already include it. See lib/guestBook.ts.
 *
 * Nothing on sale needs this any more: the one paid plan includes the guest
 * book and the slideshow, and the free trial cannot buy add-ons at all. Both
 * prices stay because the retired Starter, Standard and Event plans are still
 * stamped on real event rows, and a host on one of those can still buy either.
 * They are legacy prices now, not part of the lineup.
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

/**
 * Whether this tier is a free trial rather than a purchase.
 *
 * The gate on everything that would charge money against an event nobody paid
 * for: add-ons, upload-window extensions, and reaching Stripe at all. A
 * capability flag rather than `tier === 'free'` for the same reason
 * `customQrCode` is one — comparing ids is how the next tier silently inherits
 * the wrong behaviour.
 */
export function isTrialTier(id: string): boolean {
  return getTier(id)?.trial === true;
}

/**
 * Whether an event can be sold anything at all — add-ons, extensions, a
 * checkout. False for the free trial, true for every plan that was paid for,
 * retired ones included: retiring a plan must never strand the host on it.
 */
export function canPurchaseFor(tierId: string): boolean {
  return !isTrialTier(tierId);
}

/** Whether this tier can still be bought. The pricing page's question. */
export function isSellableTier(id: string): boolean {
  return SELLABLE_TIERS.some((t) => t.id === id);
}

/**
 * Plans that include the live slideshow at no extra cost, mirroring
 * GUEST_BOOK_INCLUDED_TIERS in lib/guestBook.ts. Plus folds in both add-ons,
 * which is most of what separates it from Event.
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

/**
 * Price to extend the upload window by 30 days: half the plan price (min $1).
 *
 * Returns 0 for a trial, which callers must read as "not for sale" rather than
 * "free" — `canPurchaseFor` is the check, and this is what the number would be
 * if anyone ignored it. Half of $0 clamped to a $1 minimum would otherwise
 * quietly invent a one-dollar product.
 */
export function extensionPrice(tierId: string): number {
  if (isTrialTier(tierId)) return 0;
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

/** When the initial upload window closes for a new event. */
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
