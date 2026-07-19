import { util } from '@aws-appsync/utils';

/**
 * Returns only ONE event's approved photos, so guests can load a gallery
 * without being able to enumerate photos across every event. Runs against the
 * Photo table with a filter on eventId.
 */
export function request(ctx) {
  return {
    operation: 'Scan',
    filter: {
      expression: '#eventId = :eventId',
      expressionNames: { '#eventId': 'eventId' },
      expressionValues: util.dynamodb.toMapValues({ ':eventId': ctx.args.eventId }),
    },
    limit: 500,
  };
}

export function response(ctx) {
  const items = ctx.result?.items ?? [];
  // Never expose unapproved photos through the public query.
  return items.filter((photo) => photo.approved !== false);
}
