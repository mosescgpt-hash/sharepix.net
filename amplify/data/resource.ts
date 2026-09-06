import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { deleteEventPhoto as deleteEventPhotoFn } from '../functions/delete-event-photo/resource';
import { createEventPhoto as createEventPhotoFn } from '../functions/create-event-photo/resource';
import { createEvent as createEventFn } from '../functions/create-event/resource';
import { updateEvent as updateEventFn } from '../functions/update-event/resource';
import { stripeCheckout as stripeCheckoutFn } from '../functions/stripe-checkout/resource';
import { printCheckout as printCheckoutFn } from '../functions/print-checkout/resource';
import { listEventPhotos as listEventPhotosFn } from '../functions/list-event-photos/resource';
import { adminUserActions as adminUserActionsFn } from '../functions/admin-user-actions/resource';
import { corporatePortal as corporatePortalFn } from '../functions/corporate-portal/resource';
import { moderatePhoto as moderatePhotoFn } from '../functions/moderate-photo/resource';
import { printProviderCheck as printProviderCheckFn } from '../functions/print-provider-check/resource';
import { sendTestAlert as sendTestAlertFn } from '../functions/send-test-alert/resource';
import { mediaUrl as mediaUrlFn } from '../functions/media-url/resource';
import { createGuestBookEntry as createGuestBookEntryFn } from '../functions/create-guest-book-entry/resource';
import { listGuestBookEntries as listGuestBookEntriesFn } from '../functions/list-guest-book-entries/resource';
import { saveMoment as saveMomentFn } from '../functions/save-moment/resource';
import { listMoments as listMomentsFn } from '../functions/list-moments/resource';

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
      // Videos are capped separately from photos: a still is resized before it
      // is ever served, while a video streams from S3 at full size on every
      // play, so it is the one upload whose cost the plan limit doesn't bound.
      // Stamped from the tier at creation. Missing means unlimited, which is
      // deliberate — events created before this existed are not retroactively
      // blocked.
      videoLimit: a.integer(),
      // Extra videos bought on top of the plan. Effective limit is
      // videoLimit + extraVideoCredits.
      extraVideoCredits: a.integer(),
      // Running count of videos, maintained alongside photoCount so the limit
      // can be reserved atomically rather than by scanning.
      videoCount: a.integer(),
      // "City, State" the host sets for the event — a memory label shown on
      // photos and used in downloads. NOT derived from photo GPS, which is
      // still stripped from every upload, and deliberately no finer than a
      // city (no street address).
      location: a.string(),
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
      // The host's choice to withhold downloads from guests. Absent or false
      // means downloads are on, which is the default and what every plan
      // includes — a legacy event with no value set must never read as blocked.
      // When true the gallery serves guests the low-resolution thumbnail and
      // hides the download controls.
      guestDownloadsBlocked: a.boolean(),
      // The live slideshow (a venue screen showing uploads as they arrive) is a
      // per-event paid add-on, available on any plan. Flipped by the webhook.
      liveSlideshowEnabled: a.boolean(),
      // The guest book: signed notes guests leave alongside their photos.
      // Included on Premium and Corporate; a per-event add-on on the cheaper
      // plans, flipped by the Stripe webhook. Missing means off, which is safe
      // because no event predates the feature — see lib/guestBook.ts.
      guestBookEnabled: a.boolean(),
      // Running count of guest book entries, maintained by
      // createGuestBookEntry so the abuse ceiling can be enforced atomically
      // without scanning. Not a product limit; see MAX_ENTRIES_PER_EVENT.
      guestBookCount: a.integer(),
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
      // How this event's QR code is styled, so a host who adds their logo gets
      // the same code every time — on the dashboard, the table tent, the
      // brochure, and every reprint. Absent means the original navy squares,
      // which is what every event created before this carries. The logo is
      // stored inline as a downscaled data URL rather than in S3: a QR centre
      // image renders at ~24% of the code, so it is tens of kilobytes and
      // travels with the row to every consumer. See lib/qrBranding.ts.
      qrDotStyle: a.string(),
      qrColor: a.string(),
      qrLogo: a.string(),
      // A branded guest upload experience for one event, e.g. 'tcc-2026'.
      // Missing means the default, which is every event unless an admin says
      // otherwise. Deliberately NOT on the updateEventSettings allow-list: only
      // an admin can put an event into a branded experience, so a host can't
      // dress their event up as someone else's.
      themeKey: a.string(),
      createdBy: a.string(),
      photos: a.hasMany('Photo', 'eventId'),
    })
    // Guests and other signed-in users may fetch a single event by id (needed
    // to open a gallery), but not `list` — that would let anyone enumerate
    // every host's events and event codes. Owners still list their own events
    // (allow.owner) and admins list all (allow.group).
    //
    // Hosts get no `create` and no `update` on their own events, only read and
    // delete. Both of those mutations let the client write the WHOLE row, and
    // most of the row is money: the plan, the photo and video limits, the
    // counters createEventPhoto maintains, the dates the retention lifecycle is
    // measured from, and `paid` — which used to default to true on create and
    // could be flipped by an update a second later. Events are created by the
    // createEvent function and changed by updateEventSettings, each of which
    // writes only what it derives or allow-lists.
    //
    // Admins keep full model access. They can already comp any event, so
    // restricting them buys nothing, and the global-admin dashboard writes
    // extraPhotoCredits and uploadWindowEndsAt directly.
    .authorization((allow) => [
      allow.owner().to(['get', 'list', 'delete']),
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
      // Which part of the event this photo belongs to, if any. OPTIONAL and
      // always will be: every photo taken before moments existed has no value
      // here, and that is a valid, permanent state rather than a migration
      // waiting to happen. Verified against the Moment's own eventId by
      // createEventPhoto before it is stored — the client's claim is not
      // trusted. A value pointing at a moment the host later deleted is also
      // valid; the gallery folds it back to "no moment". See lib/moments.ts.
      momentId: a.string(),
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

  // A named part of an event: "Getting ready", "Ceremony", "Reception".
  //
  // Hosts create these, so unlike Photo and GuestBookEntry the caller is
  // authenticated and `ownerDefinedIn` can do real work — but only on rows that
  // already exist. There is deliberately NO create and NO update here:
  // `eventOwner` is a client-written field on create, so a host could set it to
  // their own id while pointing `eventId` at somebody else's event, and inject
  // a labelled section into a stranger's gallery. `saveMoment` is the only
  // writer, and it checks the event's stored owner first.
  //
  // `delete` IS granted, because deleting requires the stored row to already
  // name the caller as its owner, which is exactly the check we want.
  //
  // Guests never read this model directly — that would enumerate every event's
  // structure platform-wide. The upload page and gallery read `eventMoments`.
  Moment: a
    .model({
      eventId: a.id().required(),
      // Stamped from the event row by saveMoment, never sent by the client.
      eventOwner: a.string(),
      name: a.string().required(),
      description: a.string(),
      // The host's ordering. Ties break on createdAt — see lib/moments.ts.
      sortOrder: a.integer(),
    })
    .secondaryIndexes((index) => [index('eventId')])
    .authorization((allow) => [
      allow.ownerDefinedIn('eventOwner').to(['get', 'list', 'delete']),
      allow.group('ADMINS'),
    ]),

  // A signed note a guest left at an event. Guest-created content the host
  // moderates, so the auth mirrors Photo exactly: no direct `create` (entries
  // come only from createGuestBookEntry, which is the only thing that can
  // verify the event is paid, open, and actually has a guest book), and no
  // guest read (that would let anyone enumerate every note at every event on
  // the platform). The public album reads through listGuestBookEntries.
  GuestBookEntry: a
    .model({
      eventId: a.id().required(),
      // Stamped from the event row by the function, never sent by the client.
      // This is what lets the host read and moderate every entry on their own
      // event without being able to touch anyone else's.
      eventOwner: a.string(),
      // How the guest signed it. Required — an unsigned note is both less
      // valuable to the couple and harder to moderate.
      name: a.string().required(),
      message: a.string(),
      // A Photo in the SAME event, verified server-side before it is stored.
      // Entries reference the existing Photo row rather than carrying media of
      // their own, so a video message goes through createEventPhoto and picks
      // up its limits, screening, preview generation and R2 mirroring for
      // free — and correctly counts against the event's video allowance,
      // because it costs exactly as much to serve.
      photoId: a.string(),
      // 'ok' shows immediately; 'flagged' waits for the host. Text screening is
      // a link check, not a content classifier — see lib/guestBook.ts.
      moderationStatus: a.string(),
      moderationReasons: a.string(),
      // The host's explicit decision to take an entry down. Beats the screening
      // verdict in both directions.
      hidden: a.boolean(),
    })
    .secondaryIndexes((index) => [index('eventId')])
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

  // A host's own account profile. Just the display name today — the name shown
  // as the host on events they create. Kept in the data layer, NOT as a Cognito
  // user-pool attribute: Cognito refuses to add attributes to an existing pool,
  // so a pool-schema approach can't be deployed. The row id is the host's sub,
  // and owner auth means each host can only read/write their own — no one can
  // enumerate or edit anyone else's.
  HostProfile: a
    .model({
      displayName: a.string(),
    })
    .authorization((allow) => [allow.owner(), allow.group('ADMINS')]),

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
      // live_slideshow, guest_book. A code covers exactly what was selected. ('all' and a
      // bare 'event' are still honored for codes created earlier.) Missing on
      // legacy codes → fall back to appliesToTier.
      appliesToScopes: a.string(),
      // 'percent' (the default, and what a missing value means) or 'amount' for
      // a fixed dollar discount.
      discountType: a.string(),
      // How much the code takes off, 1–100. A missing value (legacy codes) means
      // 100 — a fully comped, free purchase — so old codes keep working.
      percentOff: a.integer(),
      // Fixed discount in cents, used when discountType is 'amount'.
      amountOffCents: a.integer(),
      // For recurring (Corporate) subscriptions only: 'once' discounts the first
      // month, 'forever' discounts every month for as long as they stay
      // subscribed. Ignored by one-time payments. Missing = 'once'.
      recurringDuration: a.string(),
      expiresAt: a.datetime().required(),
      maxUses: a.integer().required(),
      // When true the code never runs out and maxUses is ignored — usedCount
      // still counts up, so redemptions can be measured rather than capped.
      // Missing means false, so existing codes keep their limit.
      unlimitedUses: a.boolean(),
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
    discountType: a.string(),
    percentOff: a.integer(),
    amountOffCents: a.integer(),
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
    momentId: a.string(),
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

  GuestBookEntryView: a.customType({
    id: a.string().required(),
    eventId: a.string().required(),
    name: a.string().required(),
    message: a.string(),
    photoId: a.string(),
    createdAt: a.string(),
  }),

  GuestBookEntryResult: a.customType({
    id: a.string().required(),
    eventId: a.string().required(),
    name: a.string().required(),
    message: a.string(),
    photoId: a.string(),
    // True when the note was held for the host. The guest is told, rather than
    // being sent to a page their note silently is not on.
    pending: a.boolean(),
    createdAt: a.string(),
  }),

  // Leave a signed note. Named `signGuestBook` rather than
  // createGuestBookEntry because the GuestBookEntry model already generates a
  // mutation by that name, and a collision fails the whole deployment.
  //
  // Guests are unauthenticated, so this function is the
  // whole control surface: it re-derives whether the event is paid, open and
  // entitled to a guest book, re-applies every validation rule, and proves any
  // attached photo belongs to this event before storing a reference to it.
  signGuestBook: a
    .mutation()
    .arguments({
      eventId: a.id().required(),
      name: a.string().required(),
      message: a.string(),
      photoId: a.string(),
    })
    .returns(a.ref('GuestBookEntryResult'))
    .authorization((allow) => [allow.guest(), allow.authenticated()])
    .handler(a.handler.function(createGuestBookEntryFn)),

  // Scoped read of one event's visible entries for the public album, so the
  // GuestBookEntry model never needs to grant guests list access. Named
  // `eventGuestBook` for the same reason signGuestBook is: the model already
  // generates listGuestBookEntries.
  eventGuestBook: a
    .query()
    .arguments({ eventId: a.id().required() })
    .returns(a.ref('GuestBookEntryView').array())
    .authorization((allow) => [allow.guest(), allow.authenticated()])
    .handler(a.handler.function(listGuestBookEntriesFn)),

  MomentView: a.customType({
    id: a.string().required(),
    eventId: a.string().required(),
    name: a.string().required(),
    description: a.string(),
    sortOrder: a.integer(),
    createdAt: a.string(),
  }),

  // Create or rename one moment. Named `saveMoment` rather than createMoment or
  // updateMoment because the Moment model already generates BOTH of those, and
  // a name collision fails the entire deployment rather than the one field —
  // the same trap that broke deployments 124 and 125 with createEvent, and the
  // reason signGuestBook is not called createGuestBookEntry.
  //
  // Omitting `momentId` creates; sending one renames that moment in place.
  // Either way the event's stored owner is checked against the caller first, so
  // a host cannot write into an event they do not own.
  saveMoment: a
    .mutation()
    .arguments({
      eventId: a.id().required(),
      momentId: a.id(),
      name: a.string().required(),
      description: a.string(),
      sortOrder: a.integer(),
    })
    .returns(a.ref('MomentView'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(saveMomentFn)),

  // One event's moments, for the guest upload picker and the gallery. Scoped
  // the same way listEventPhotos and eventGuestBook are, so the Moment model
  // never has to grant guests list access. Named `eventMoments` because the
  // model generates listMoments.
  eventMoments: a
    .query()
    .arguments({ eventId: a.id().required() })
    .returns(a.ref('MomentView').array())
    .authorization((allow) => [allow.guest(), allow.authenticated()])
    .handler(a.handler.function(listMomentsFn)),

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

  // Global-admin only: price a one-print order through Prodigi's quotes
  // endpoint to confirm the live key, network path and SKUs work. Creates
  // nothing and charges nothing. Takes no arguments — there is no input to
  // trust, and the ADMINS group is the whole authorization story.
  checkPrintProvider: a
    .mutation()
    .arguments({})
    .returns(a.ref('UserActionResult'))
    .authorization((allow) => [allow.group('ADMINS')])
    .handler(a.handler.function(printProviderCheckFn)),

  // Global-admin only: send the real "photo held for review" alert to the
  // signed-in admin, so delivery and rendering can be checked without waiting
  // for a photo to actually be flagged. Takes no arguments — the recipient is
  // read from the caller's token, never from the request, so this can never
  // become a way to send mail from our domain to an arbitrary address.
  sendTestAlertEmail: a
    .mutation()
    .arguments({})
    .returns(a.ref('UserActionResult'))
    .authorization((allow) => [allow.group('ADMINS')])
    .handler(a.handler.function(sendTestAlertFn)),

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
      // For kind 'addons': which per-event add-ons to buy together, as a
      // comma-separated list of extend | live_slideshow. (guest_download is a
      // retired scope that may still appear on codes created before it was
      // folded into every plan.)
      addons: a.string(),
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

  CreatedEvent: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    eventCode: a.string().required(),
    tier: a.string().required(),
    date: a.string(),
    location: a.string(),
    photoLimit: a.integer(),
    videoLimit: a.integer(),
    accessExpiresAt: a.string(),
    uploadWindowEndsAt: a.string(),
    /** false = created but inactive until the Stripe webhook confirms payment. */
    paid: a.boolean().required(),
    createdBy: a.string(),
    owner: a.string(),
    createdAt: a.string(),
  }),

  // Creates an event. The only way to make one — the Event model grants no
  // `create` to anyone.
  //
  // The request says what the event IS (a name, a date, a place, a plan) and
  // never what it COSTS or what it's WORTH: the photo and video limits, both
  // expiry dates, the event code, the owner, and whether it starts active are
  // all derived server-side. Previously every one of those came from the
  // browser, and `paid` defaulted to true.
  //
  // An event starts active only via a live Corporate subscription or a discount
  // code that covers the whole price, both read from their own tables. Anything
  // else is created pending, and createEventPhoto refuses uploads to it until
  // the Stripe webhook flips `paid`.
  //
  // NOT called `createEvent`: the Event model still generates its own
  // `createEvent` mutation for admins, and AppSync refuses two fields of the
  // same name ("Object type extension 'Mutation' cannot redeclare field
  // createEvent"). That is a deploy-time error the typecheck and unit tests
  // cannot see, which is what `npm run validate:backend` now exists to catch.
  createHostedEvent: a
    .mutation()
    .arguments({
      name: a.string().required(),
      tier: a.string().required(),
      date: a.string(),
      city: a.string(),
      state: a.string(),
      discountCode: a.string(),
    })
    .returns(a.ref('CreatedEvent'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(createEventFn)),

  // Changes an event's host-editable settings. The Event model grants owners no
  // `update`, so this is the only way a host changes their own event, and the
  // allow-list in the function is the entire surface: a field it doesn't name
  // cannot be written by a host at all.
  //
  // Omitting an argument leaves that field alone; sending it empty clears the
  // ones that can be cleared (date, location, alertEmail). Ownership is checked
  // against the stored row, and "not yours" and "no such event" give the same
  // answer so this can't be used to discover event ids.
  updateEventSettings: a
    .mutation()
    .arguments({
      eventId: a.id().required(),
      name: a.string(),
      date: a.string(),
      city: a.string(),
      state: a.string(),
      moderationMode: a.string(),
      alertEmail: a.string(),
      videoUploadsEnabled: a.boolean(),
      guestDownloadsBlocked: a.boolean(),
      uploadsClosed: a.boolean(),
      qrDotStyle: a.string(),
      qrColor: a.string(),
      qrLogo: a.string(),
    })
    .returns(a.ref('UserActionResult'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(updateEventFn)),

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
      // Which moment the guest was filing under, usually from the QR code they
      // scanned. A claim, not a fact: the function checks the moment's stored
      // eventId matches before keeping it, and silently drops it otherwise
      // rather than failing an upload the guest has already waited through.
      momentId: a.string(),
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

  // A signed URL for one stored object, served from Cloudflare R2 where egress
  // is free. `url` is null whenever R2 cannot serve it — unconfigured, the
  // object was never mirrored, or the caller may not have it — and the client
  // falls back to S3, which is what every caller did before this existed.
  MediaUrl: a.customType({
    key: a.string().required(),
    url: a.string(),
  }),

  // Batched, because a gallery needs one URL per photo and a per-photo query
  // would mean hundreds of round trips to open a single page. A download asks
  // for one key through the same path.
  mediaUrls: a
    .query()
    .arguments({ eventId: a.id().required(), keys: a.string().array().required() })
    .returns(a.ref('MediaUrl').array())
    // Guests have no account, so this has to be reachable by them; the handler
    // decides which of the requested keys any given caller may actually have.
    .authorization((allow) => [allow.guest(), allow.authenticated()])
    .handler(a.handler.function(mediaUrlFn)),

  // `redeemDiscountCode` used to live here: a mutation that spent one use of a
  // code and gave nothing back but a confirmation. Any signed-in caller could
  // run it against any code they could name, burning an admin's limited-use
  // codes without buying a thing — and the create-event page called it as a
  // separate step *before* creating the event, so an interrupted signup spent a
  // use anyway. Redemption now happens inside createEvent, conditionally and in
  // the same request that produces the free event, so a code is only ever spent
  // on something that exists. validateDiscountCode above stays: it only reads.
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
