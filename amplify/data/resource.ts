import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

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
      accessExpiresAt: a.datetime(),
      createdBy: a.string(),
      photos: a.hasMany('Photo', 'eventId'),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group('ADMINS'),
      allow.authenticated().to(['read']),
      allow.guest().to(['read']),
    ]),

  Photo: a
    .model({
      eventId: a.id().required(),
      event: a.belongsTo('Event', 'eventId'),
      s3Key: a.string().required(),
      uploadedBy: a.string(),
      uploadedByUserId: a.string(),
      approved: a.boolean(),
      eventOwner: a.string(),
    })
    .secondaryIndexes((index) => [index('eventId')])
    .authorization((allow) => [
      allow.ownerDefinedIn('eventOwner'),
      allow.group('ADMINS'),
      allow.authenticated().to(['create', 'read']),
      allow.guest().to(['create', 'read']),
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
