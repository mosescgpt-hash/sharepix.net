import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { deleteEventPhoto as deleteEventPhotoFn } from '../functions/delete-event-photo/resource';
import { createEventPhoto as createEventPhotoFn } from '../functions/create-event-photo/resource';
import { stripeCheckout as stripeCheckoutFn } from '../functions/stripe-checkout/resource';

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
      uploadedBy: a.string(),
      uploadedByUserId: a.string(),
      approved: a.boolean(),
      eventOwner: a.string(),
    })
    .secondaryIndexes((index) => [index('eventId')])
    // No direct `create`: photos are created only through the createEventPhoto
    // function, which stamps eventOwner from the event server-side and enforces
    // the photo limit. Clients can therefore no longer spoof ownership,
    // self-approve, or bypass the limit.
    .authorization((allow) => [
      allow.ownerDefinedIn('eventOwner'),
      allow.group('ADMINS'),
      allow.authenticated().to(['read']),
      allow.guest().to(['read']),
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

  DiscountCode: a
    .model({
      code: a.string().required(),
      assignedTo: a.string(),
      active: a.boolean().required(),
      appliesToTier: a.string().required(),
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
    uploadedBy: a.string(),
    uploadedByUserId: a.string(),
    approved: a.boolean(),
    eventOwner: a.string(),
    createdAt: a.string(),
  }),

  CheckoutSession: a.customType({
    url: a.string().required(),
  }),

  // Starts a Stripe Checkout Session for a plan and returns the hosted URL.
  createCheckoutSession: a
    .mutation()
    .arguments({ tier: a.string().required() })
    .returns(a.ref('CheckoutSession'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(stripeCheckoutFn)),

  // Creates a photo record after stamping eventOwner from the event and
  // enforcing the event's photo limit (plan limit + purchased extra credits).
  createEventPhoto: a
    .mutation()
    .arguments({
      eventId: a.id().required(),
      s3Key: a.string().required(),
      previewS3Key: a.string(),
      uploadedBy: a.string(),
      uploadedByUserId: a.string(),
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
