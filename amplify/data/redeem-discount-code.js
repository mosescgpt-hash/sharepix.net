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
      expression:
        '#active = :active AND #tier = :requestedTier AND #expiresAt > :now AND #usedCount < #maxUses',
      expressionNames: {
        '#active': 'active',
        '#tier': 'appliesToTier',
        '#expiresAt': 'expiresAt',
        '#usedCount': 'usedCount',
        '#maxUses': 'maxUses',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':active': true,
        ':requestedTier': tier,
        ':now': now,
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
    remainingUses: ctx.result.maxUses - ctx.result.usedCount,
  };
}
