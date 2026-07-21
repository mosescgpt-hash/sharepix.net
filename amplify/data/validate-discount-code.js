import { util } from '@aws-appsync/utils';

export function request(ctx) {
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
  // The code carries the plan it unlocks (appliesToTier); it is valid as long
  // as it is active, unexpired, and has uses left — whichever plan it's for.
  const valid =
    code &&
    code.active === true &&
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
    message: 'Pilot access applied.',
    code: code.code,
    appliesToTier: code.appliesToTier,
    remainingUses: code.maxUses - code.usedCount,
  };
}
