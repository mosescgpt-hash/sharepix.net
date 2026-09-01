/**
 * What a checkout is allowed to charge, and for whose event.
 *
 * Pulled out of the handler because it is the security-critical decision in the
 * whole file, and because getting it wrong is silent: the customer pays, Stripe
 * succeeds, and the event activates. Nothing errors.
 *
 * The bug this exists to prevent: the amount used to be priced from the `tier`
 * the request sent, while the webhook activated whatever `eventId` the request
 * named. Those are two independent inputs, so pairing a Premium event with
 * tier="starter" charged $19 and activated a $79 event. Both values now come
 * from the same stored row, which makes the pairing impossible to forge.
 */

export interface StoredEvent {
  /** The event's plan, as stored on its row. */
  tier: string;
  /** Amplify owner string, "<sub>::<username>". */
  owner: string;
}

export interface Caller {
  /** Cognito subject of the signed-in host, if any. */
  sub?: string;
  groups?: string[] | null;
}

export type PricingSource =
  /** Priced from the event's own row — the only path that activates an event. */
  | { kind: 'event'; tier: string }
  /** Priced from the request. Activates nothing; used by the admin test checkout. */
  | { kind: 'argument'; tier: string }
  /** Refused. `reason` is deliberately the same for missing and not-yours. */
  | { kind: 'refused'; reason: string };

/**
 * Deliberately identical for "no such event" and "not your event", so this
 * cannot be used to discover which event ids exist.
 */
const REFUSED = 'That event could not be found, or its plan is no longer sold.';

export function isAdminCaller(caller: Caller | null | undefined): boolean {
  return (caller?.groups ?? [])?.includes('ADMINS') === true;
}

/**
 * Decide where the price comes from.
 *
 * @param eventId      the event this payment would activate, or '' for the
 *                     admin test checkout
 * @param argumentTier the `tier` the request supplied — used ONLY when no event
 *                     is being activated
 * @param stored       the event's stored row, or null when it does not exist
 * @param sellableTier whether a tier is one we currently sell
 * @param caller       the signed-in identity
 */
export function pricingSourceFor({
  eventId,
  argumentTier,
  stored,
  sellableTier,
  caller,
}: {
  eventId: string;
  argumentTier: string;
  stored: StoredEvent | null;
  sellableTier: (tier: string) => boolean;
  caller: Caller | null | undefined;
}): PricingSource {
  if (!eventId) {
    const tier = (argumentTier ?? '').toLowerCase();
    return sellableTier(tier)
      ? { kind: 'argument', tier }
      : { kind: 'refused', reason: 'Unknown plan.' };
  }

  if (!stored) return { kind: 'refused', reason: REFUSED };

  const tier = (stored.tier ?? '').toLowerCase();
  if (!sellableTier(tier)) return { kind: 'refused', reason: REFUSED };

  // Pay for your own event. An admin can pay for any, so an event can be comped.
  if (isAdminCaller(caller)) return { kind: 'event', tier };

  const sub = caller?.sub ?? '';
  if (!sub || !stored.owner.includes(sub)) {
    return { kind: 'refused', reason: REFUSED };
  }

  return { kind: 'event', tier };
}
