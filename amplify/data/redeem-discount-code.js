import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const code = ctx.args.code;
  const tier = ctx.args.tier;
  const now = util.time.nowISO8601();

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ code }),
    update: {
      expression: 'ADD #usedCount :one SET #lastUsedAt = :now',
      expressionNames: {
        '#usedCount': 'usedCount',
        '#lastUsedAt': 'lastUsedAt',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':one': 1,
        ':now': now,
      }),
    },
    condition: {
      // An 'all' code applies to any plan; a tier-scoped code must match the
      // plan being redeemed.
      // An unlimited code skips the usage ceiling. A code without the attribute
      // simply fails that comparison and falls through to the count check, so
      // existing codes keep their limit.
      expression:
        '#active = :active AND (#tier = :requestedTier OR #tier = :all) AND #expiresAt > :now AND (#unlimited = :true OR #usedCount < #maxUses)',
      expressionNames: {
        '#active': 'active',
        '#tier': 'appliesToTier',
        '#expiresAt': 'expiresAt',
        '#usedCount': 'usedCount',
        '#maxUses': 'maxUses',
        '#unlimited': 'unlimitedUses',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':active': true,
        ':requestedTier': tier,
        ':all': 'all',
        ':now': now,
        ':true': true,
      }),
    },
  };
}

export function response(ctx) {
  if (ctx.error || !ctx.result) {
    return {
      valid: false,
      message: 'That code is invalid, expired, inactive, or has no uses remaining.',
    };
  }

  return {
    valid: true,
    message: 'Pilot access applied.',
    code: ctx.result.code,
    appliesToTier: ctx.result.appliesToTier,
    discountType: ctx.result.discountType === 'amount' ? 'amount' : 'percent',
    percentOff: ctx.result.percentOff == null ? 100 : ctx.result.percentOff,
    amountOffCents:
      ctx.result.amountOffCents == null ? null : ctx.result.amountOffCents,
    remainingUses:
      ctx.result.unlimitedUses === true
        ? null
        : ctx.result.maxUses - ctx.result.usedCount,
  };
}
