import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { deleteEventPhoto as deleteEventPhotoFn } from '../functions/delete-event-photo/resource';
import { createEventPhoto as createEventPhotoFn } from '../functions/create-event-photo/resource';
import { stripeCheckout as stripeCheckoutFn } from '../functions/stripe-checkout/resource';
import { printCheckout as printCheckoutFn } from '../functions/print-checkout/resource';
import { listEventPhotos as listEventPhotosFn } from '../functions/list-event-photos/resource';
import { adminUserActions as adminUserActionsFn } from '../functions/admin-user-actions/resource';
import { corporatePortal as corporatePortalFn } from '../functions/corporate-portal/resource';
import { moderatePhoto as moderatePhotoFn } from '../functions/moderate-photo/resource';

/**
 * SharePix data models.
 * - Hosts (signed in, userPool) own Events.
 * - Guests (identity pool, unauthenticated) can read events and
 *   create/read photos — no account needed.
 * - Photos carry `eventOwner` (the host's owner id) so the HOST can
 *   moderate/delete any photo in their event, not just their own uploads.
 */
const schema = a.schema({
  Event: a
    .model({
      name: a.string().required(),
      eventCode: a.string().required(),
      date: a.date(),
      tier: a.string().required(),
      photoLimit: a.integer(),
      // Extra photo capacity purchased on top of the plan (the "buy more
      // storage" add-on). Effective limit = photoLimit + extraPhotoCredits.
      extraPhotoCredits: a.integer(),
      // Running count of photos, maintained by the create/delete functions so
      // the limit can be enforced atomically without scanning the table.
      photoCount: a.integer(),
      accessExpiresAt: a.datetime(),
      // When the 30-day upload window closes (creation + 30 days, plus any paid
      // extensions). Drives the whole lifecycle: uploads, guest view resolution,
      // host retention, and archival. Extended by the Stripe webhook.
      uploadWindowEndsAt: a.datetime(),
      // When true, the host has closed the event: guests can no longer upload,
      // but the gallery stays viewable. Enforced server-side in createEventPhoto.
      uploadsClosed: a.boolean(),
      // Payment gate. `false` = created but awaiting payment (not active); `true`
      // = paid or comped (active). A missing value (older events) is treated as
      // active for backward compatibility. Flipped to true by the Stripe webhook.
      paid: a.boolean(),
      // Guest downloads are off by default on every plan. Corporate hosts can
      // buy a per-event add-on that flips this to true (via the Stripe webhook).
      guestDownloadEnabled: a.boolean(),
      // The live slideshow (a venue screen showing uploads as they arrive) is a
      // per-event paid add-on, available on any plan. Flipped by the webhook.
      liveSlideshowEnabled: a.boolean(),
      // How uploads are screened for this event. 'review' (the default, and what
      // a missing value means) holds potentially explicit photos back for the
      // host; 'allow_all' skips screening entirely and shows everything
      // immediately. The host chooses on the event dashboard.
      moderationMode: a.string(),
      // Where to email the host when a photo is held for review. Optional — a
      // held photo is always reviewable from the dashboard regardless.
      alertEmail: a.string(),
      // Whether guests may upload video. Missing means allowed, so existing
      // events are unchanged. Hosts who want only screened media can turn it
      // off, since automated screening covers stills but not video.
      videoUploadsEnabled: a.boolean(),
      createdBy: a.string(),
      photos: a.hasMany('Photo', 'eventId'),
    })
    // Guests and other signed-in users may fetch a single event by id (needed
    // to open a gallery), but not `list` — that would let anyone enumerate
    // every host's events and event codes. Owners still list their own events
    // (allow.owner) and admins list all (allow.group).
    .authorization((allow) => [
      allow.owner(),
      allow.group('ADMINS'),
      allow.authenticated().to(['get']),
      allow.guest().to(['get']),
    ]),

  Photo: a
    .model({
      eventId: a.id().required(),
      event: a.belongsTo('Event', 'eventId'),
      s3Key: a.string().required(),
      previewS3Key: a.string(),
      // Small low-res image shown to guests during the post-window low-res phase.
      thumbS3Key: a.string(),
      uploadedBy: a.string(),
      uploadedByUserId: a.string(),
      approved: a.boolean(),
      eventOwner: a.string(),
      // SHA-256 of the file's bytes, used to skip duplicate uploads within an
      // event. Same photo (identical bytes) → same hash.
      contentHash: a.string(),
      // Automated content screening. 'ok' = screened and clean, 'flagged' =
      // held back from guests and the live slideshow pending host review,
      // 'released' = host reviewed a flagged photo and allowed it, 'skipped' =
      // not screened (a video, or screening was unavailable). Missing on photos
      // uploaded before screening existed, and treated as visible.
      moderationStatus: a.string(),
      // What the screener detected, for the host's review screen.
      moderationReasons: a.string(),
    })
    .secondaryIndexes((index) => [index('eventId')])
    // No direct `create` (photos come only from createEventPhoto) and no
    // guest/authenticated read (that allowed listing every photo across all
    // events). The host (eventOwner) and admins keep full access for
    // moderation/downloads; the public gallery reads through the scoped
    // listEventPhotos query.
    .authorization((allow) => [
      allow.ownerDefinedIn('eventOwner'),
      allow.group('ADMINS'),
    ]),

  DownloadShare: a
    .model({
      eventId: a.id().required(),
      eventName: a.string().required(),
      photoIdsJson: a.string().required(),
      expiresAt: a.datetime(),
      createdBy: a.string(),
    })
    .secondaryIndexes((index) => [index('eventId')])
    // Fetch a single share by id (for the share page), not list — same
    // enumeration concern as Event.
    .authorization((allow) => [
      allow.owner(),
      allow.group('ADMINS'),
      allow.authenticated().to(['get']),
      allow.guest().to(['get']),
    ]),

  // Recorded by the Stripe webhook when a checkout completes. Admins read these
  // to confirm payments landed; the webhook writes them directly (via the table
  // grant in backend.ts), so no model-level create/update is granted here.
  Payment: a
    .model({
      stripeSessionId: a.string(),
      amountTotal: a.integer(),
      currency: a.string(),
      tier: a.string(),
      eventId: a.string(),
      customerEmail: a.string(),
      status: a.string(),
    })
    .authorization((allow) => [allow.group('ADMINS')]),

  // A guest's print order. Written directly by the print-checkout function
  // (status `pending`) and updated by the Stripe webhook once payment completes
  // and the order is submitted to Prodigi (via table grants in backend.ts), so
  // no model-level create/update is granted here. Admins read to track orders.
  PrintOrder: a
    .model({
      eventId: a.string(),
      // pending → checkout started; submitted → sent to Prodigi; failed → paid
      // but Prodigi rejected it (needs manual follow-up).
      status: a.string(),
      // JSON snapshot of the ordered items: [{ sku, name, size, copies, s3Key,
      // photoId, unitPriceCents }]. The webhook regenerates signed URLs from the
      // s3Keys at submission time.
      itemsJson: a.string(),
      stripeSessionId: a.string(),
      prodigiOrderId: a.string(),
      amountTotal: a.integer(),
      currency: a.string(),
      customerEmail: a.string(),
      shippingName: a.string(),
      // JSON snapshot of the shipping address Stripe collected.
      shippingJson: a.string(),
      // Prodigi error detail when status is `failed`.
      error: a.string(),
    })
    .authorization((allow) => [allow.group('ADMINS')]),

  // A host's Corporate subscription state, keyed by their Cognito user id.
  // The Stripe webhook writes this directly (owner is stamped from the checkout
  // metadata); the host reads their own row via owner auth to see their status.
  CorporateSubscription: a
    .model({
      userId: a.string().required(),
      email: a.string(),
      status: a.string(), // active | canceled | past_due | ...
      stripeCustomerId: a.string(),
      stripeSubscriptionId: a.string(),
      currentPeriodEnd: a.datetime(),
      cancelAtPeriodEnd: a.boolean(),
      // When the subscription ends, downloads stay available until this date
      // (30 days past the last paid period).
      downloadGraceEndsAt: a.datetime(),
    })
    .identifier(['userId'])
    .authorization((allow) => [allow.owner(), allow.group('ADMINS')]),

  // A one-photo review link for a flagged upload. The token IS the credential —
  // the host opens it from an alert without signing in — so it is generated as
  // 64 hex chars of CSPRNG output, scoped to a single photo, and expires.
  //
  // Deliberately, neither outcome is destructive: a review can release a photo
  // or leave it hidden, never delete it. A leaked link therefore can't destroy a
  // couple's photos; permanent deletion stays behind the host's signed-in
  // dashboard.
  ModerationReview: a
    .model({
      token: a.string().required(),
      photoId: a.string().required(),
      eventId: a.string().required(),
      eventName: a.string(),
      photoS3Key: a.string().required(),
      // What the screener detected, shown to whoever reviews it.
      reasons: a.string(),
      // pending → awaiting a decision; released → shown to guests; dismissed →
      // left hidden.
      status: a.string().required(),
      expiresAt: a.datetime().required(),
      decidedAt: a.datetime(),
    })
    .identifier(['token'])
    // Fetch a single review by its token (never list — that would enumerate
    // every pending review). Same shape as DownloadShare.
    .authorization((allow) => [
      allow.group('ADMINS'),
      allow.authenticated().to(['get']),
      allow.guest().to(['get']),
    ]),

  DiscountCode: a
    .model({
      code: a.string().required(),
      assignedTo: a.string(),
      active: a.boolean().required(),
      // The plan a code unlocks. 'all' (new admin codes) means it applies to any
      // paid flow on the site (events, corporate, extend, guest-download add-on).
      // Legacy codes carry a specific tier id.
      appliesToTier: a.string().required(),
      // The paid items the code can be redeemed against, comma-separated:
      // event:starter, event:standard, event:premium, corporate, extend,
      // guest_download. A code covers exactly what was selected. ('all' and a
      // bare 'event' are still honored for codes created earlier.) Missing on
      // legacy codes → fall back to appliesToTier.
      appliesToScopes: a.string(),
      // How much the code takes off, 1–100. A missing value (legacy codes) means
      // 100 — a fully comped, free purchase — so old codes keep working.
      percentOff: a.integer(),
      // For recurring (Corporate) subscriptions only: 'once' discounts the first
      // month, 'forever' discounts every month for as long as they stay
      // subscribed. Ignored by one-time payments. Missing = 'once'.
      recurringDuration: a.string(),
      expiresAt: a.datetime().required(),
      maxUses: a.integer().required(),
      usedCount: a.integer().required(),
      lastUsedAt: a.datetime(),
      createdBy: a.string(),
    })
    .identifier(['code'])
    .authorization((allow) => [allow.group('ADMINS')]),

  DiscountRedemption: a.customType({
    valid: a.boolean().required(),
    message: a.string(),
    code: a.string(),
    appliesToTier: a.string(),
    percentOff: a.integer(),
    remainingUses: a.integer(),
  }),

  PhotoDeletionResult: a.customType({
    success: a.boolean().required(),
    message: a.string(),
  }),

  PhotoUploadResult: a.customType({
    id: a.string().required(),
    eventId: a.string().required(),
    s3Key: a.string().required(),
    previewS3Key: a.string(),
    thumbS3Key: a.string(),
    uploadedBy: a.string(),
    uploadedByUserId: a.string(),
    approved: a.boolean(),
    eventOwner: a.string(),
    contentHash: a.string(),
    // True when this upload matched a photo the event already had, so the
    // existing record was returned instead of a second copy being created.
    duplicate: a.boolean(),
    createdAt: a.string(),
  }),

  EventPhoto: a.customType({
    id: a.string().required(),
    eventId: a.string().required(),
    s3Key: a.string().required(),
    previewS3Key: a.string(),
    thumbS3Key: a.string(),
    uploadedBy: a.string(),
    uploadedByUserId: a.string(),
    approved: a.boolean(),
    eventOwner: a.string(),
    contentHash: a.string(),
    createdAt: a.string(),
  }),

  // Scoped read of one event's approved photos for the public gallery, so the
  // Photo model won't need to grant guests broad list access.
  listEventPhotos: a
    .query()
    .arguments({ eventId: a.id().required() })
    .returns(a.ref('EventPhoto').array())
    .authorization((allow) => [allow.guest(), allow.authenticated()])
    .handler(a.handler.function(listEventPhotosFn)),

  UserActionResult: a.customType({
    success: a.boolean().required(),
    message: a.string(),
  }),

  // Global-admin only: reset a user's password or enable/disable their account.
  manageUser: a
    .mutation()
    .arguments({ email: a.string().required(), action: a.string().required() })
    .returns(a.ref('UserActionResult'))
    .authorization((allow) => [allow.group('ADMINS')])
    .handler(a.handler.function(adminUserActionsFn)),

  CheckoutSession: a.customType({
    url: a.string().required(),
  }),

  // Starts a Stripe Checkout Session and returns the hosted URL.
  // - kind 'corporate' → a recurring $149/month subscription checkout.
  // - otherwise → a one-time event payment; eventId (optional) ties it to a
  //   pending event so the webhook can activate it once payment completes.
  createCheckoutSession: a
    .mutation()
    .arguments({
      tier: a.string().required(),
      eventId: a.string(),
      kind: a.string(),
      // Optional admin discount code applied server-side as a Stripe coupon.
      discountCode: a.string(),
    })
    .returns(a.ref('CheckoutSession'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(stripeCheckoutFn)),

  // Guest-facing: starts a Stripe Checkout Session for a print order of one or
  // more of an event's photos. Guests may call it (no account needed); the
  // function enforces the guest-download gate and validates every photo belongs
  // to the event. itemsJson is [{ sku, copies, s3Key, photoId }].
  createPrintCheckout: a
    .mutation()
    .arguments({ eventId: a.string().required(), itemsJson: a.string().required() })
    .returns(a.ref('CheckoutSession'))
    .authorization((allow) => [allow.guest(), allow.authenticated()])
    .handler(a.handler.function(printCheckoutFn)),

  // Opens the Stripe billing portal so a corporate host can manage or cancel
  // their subscription themselves. Returns the hosted portal URL.
  openBillingPortal: a
    .mutation()
    .arguments({})
    .returns(a.ref('CheckoutSession'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(corporatePortalFn)),

  // Creates a photo record after stamping eventOwner from the event and
  // enforcing the event's photo limit (plan limit + purchased extra credits).
  createEventPhoto: a
    .mutation()
    .arguments({
      eventId: a.id().required(),
      s3Key: a.string().required(),
      previewS3Key: a.string(),
      thumbS3Key: a.string(),
      uploadedBy: a.string(),
      uploadedByUserId: a.string(),
      contentHash: a.string(),
    })
    .returns(a.ref('PhotoUploadResult'))
    .authorization((allow) => [allow.guest(), allow.authenticated()])
    .handler(a.handler.function(createEventPhotoFn)),

  // Deletes a photo's S3 objects and record behind an ownership check, so S3
  // delete permission never has to be granted to every signed-in user.
  deleteEventPhoto: a
    .mutation()
    .arguments({ photoId: a.id().required() })
    .returns(a.ref('PhotoDeletionResult'))
    .authorization((allow) => [allow.authenticated(), allow.group('ADMINS')])
    .handler(a.handler.function(deleteEventPhotoFn)),

  // Acts on a flagged photo from a review link, with no sign-in — the token is
  // the authorization, and the function re-validates it (exists, pending,
  // unexpired) before touching anything. `action` is 'release' or 'dismiss'.
  reviewFlaggedPhoto: a
    .mutation()
    .arguments({ token: a.string().required(), action: a.string().required() })
    .returns(a.ref('UserActionResult'))
    .authorization((allow) => [allow.guest(), allow.authenticated()])
    .handler(a.handler.function(moderatePhotoFn)),

  validateDiscountCode: a
    .query()
    .arguments({
      code: a.string().required(),
      tier: a.string().required(),
    })
    .returns(a.ref('DiscountRedemption'))
    .authorization((allow) => [allow.authenticated()])
    .handler(
      a.handler.custom({
        dataSource: a.ref('DiscountCode'),
        entry: './validate-discount-code.js',
      }),
    ),

  redeemDiscountCode: a
    .mutation()
    .arguments({
      code: a.string().required(),
      tier: a.string().required(),
    })
    .returns(a.ref('DiscountRedemption'))
    .authorization((allow) => [allow.authenticated()])
    .handler(
      a.handler.custom({
        dataSource: a.ref('DiscountCode'),
        entry: './redeem-discount-code.js',
      }),
    ),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
