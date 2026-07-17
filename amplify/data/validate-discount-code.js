import { util } from '@aws-appsync/utils';

export function request(ctx) {
  ctx.stash.requestedTier = ctx.args.tier;
  ctx.stash.now = util.time.nowISO8601();

  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      code: ctx.args.code,
    }),
  };
}

export function response(ctx) {
  const code = ctx.result;
  const valid =
    code &&
    code.active === true &&
    code.appliesToTier === 'standard' &&
    ctx.stash.requestedTier === 'standard' &&
    code.expiresAt > ctx.stash.now &&
    code.usedCount < code.maxUses;

  if (!valid) {
    return {
      valid: false,
      message: 'That code is invalid, expired, inactive, or has no uses remaining.',
    };
  }

  return {
    valid: true,
    message: 'Standard pilot access applied.',
    code: code.code,
    appliesToTier: code.appliesToTier,
    remainingUses: code.maxUses - code.usedCount,
  };
}
