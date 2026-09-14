import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import type { Stack } from 'aws-cdk-lib';

/**
 * Rate limiting in front of the GraphQL API.
 *
 * ## Why this exists, and why it is off by default
 *
 * `findEventByCode` is the one endpoint on SharePix that takes a guess and
 * says whether it was right. Everything else either needs a credential or
 * returns the same answer whatever you send it; that one is an oracle, and an
 * oracle without a throttle is enumerable given enough time.
 *
 * Event codes are now three words from a 7,772-word list — about 4.7 × 10¹¹
 * combinations — which already puts a single-IP attack out of reach. This is
 * the belt to that pair of braces, and it is the half that keeps working when
 * somebody eventually shortens a code or adds a second oracle without
 * thinking about it.
 *
 * It is **off unless `WAF_ENABLED` is set**, because it is the only thing in
 * this backend with a fixed monthly bill:
 *
 *   Web ACL           $5.00 / month
 *   Two rules         $2.00 / month
 *   Requests          $0.60 per million
 *
 * Roughly $7 a month before traffic. Small in absolute terms and not small
 * against a handful of $79 events, so turning it on is a decision with a
 * number attached rather than a default somebody inherits. The sensible
 * moment is when there are enough live events that guessing any one of them
 * becomes plausible — a few thousand — or sooner if the endpoint ever starts
 * costing real money to hit.
 *
 * ## The two rules
 *
 * **A broad ceiling.** 2,000 requests per five minutes per IP. A gallery page
 * load is a handful of requests and the widest single call signs up to 600
 * keys at once, so a real visitor never approaches this; it exists to stop
 * somebody hammering the API generally.
 *
 * **A tight one on the oracle.** 100 requests per minute per IP, scoped by a
 * body match on the operation name. Somebody typing a code off a card makes
 * one request, maybe two after a typo. A hundred a minute is absurdly
 * generous for a person and useless for a scanner.
 *
 * 100 is not a number chosen for elegance: it is AWS WAF's minimum for a
 * rate-based rule. Anything tighter has to be built in application code, and
 * is not worth it while the keyspace is this large.
 *
 * ## What this does not do
 *
 * Stop a distributed attack. Rate limits are per IP, and an attacker with a
 * thousand addresses gets a thousand times the budget. That is a real limit
 * and the honest mitigation is the keyspace, not this — which is the argument
 * for the word codes having been the more important change of the two.
 */

/** Requests per five minutes, per IP, across the whole API. */
export const BROAD_RATE_LIMIT = 2000;

/**
 * Requests per minute, per IP, for the code lookup.
 *
 * AWS WAF will not accept a rate-based limit below 100, so this is the floor
 * rather than a considered figure.
 */
export const LOOKUP_RATE_LIMIT = 100;

/** The GraphQL operation the tight rule watches for in the request body. */
export const THROTTLED_OPERATION = 'findEventByCode';

/**
 * Attach a Web ACL to the AppSync API.
 *
 * Returns null when `WAF_ENABLED` is unset, so the stack synthesises
 * identically to before and nothing is billed. Deliberately a no-op rather
 * than a conditional resource: a Web ACL that exists but is not associated
 * still costs $5 a month and protects nothing.
 */
export function attachWaf(stack: Stack, graphqlApiArn: string): CfnWebACL | null {
  if (!process.env.WAF_ENABLED) return null;

  const acl = new CfnWebACL(stack, 'ApiRateLimit', {
    // AppSync is regional. CLOUDFRONT scope would be rejected here.
    scope: 'REGIONAL',
    defaultAction: { allow: {} },
    visibilityConfig: {
      cloudWatchMetricsEnabled: true,
      metricName: 'SharepixApi',
      sampledRequestsEnabled: true,
    },
    rules: [
      {
        name: 'LookupOracle',
        // Evaluated first. A request that trips this is blocked before the
        // broad rule has a chance to allow it.
        priority: 0,
        action: { block: {} },
        statement: {
          rateBasedStatement: {
            limit: LOOKUP_RATE_LIMIT,
            evaluationWindowSec: 60,
            aggregateKeyType: 'IP',
            // Only requests naming the operation. Without this the tight
            // limit would apply to every gallery load and break the product.
            scopeDownStatement: {
              byteMatchStatement: {
                fieldToMatch: { body: { oversizeHandling: 'CONTINUE' } },
                positionalConstraint: 'CONTAINS',
                searchString: THROTTLED_OPERATION,
                textTransformations: [{ priority: 0, type: 'NONE' }],
              },
            },
          },
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: 'LookupOracle',
          sampledRequestsEnabled: true,
        },
      },
      {
        name: 'BroadCeiling',
        priority: 1,
        action: { block: {} },
        statement: {
          rateBasedStatement: {
            limit: BROAD_RATE_LIMIT,
            evaluationWindowSec: 300,
            aggregateKeyType: 'IP',
          },
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: 'BroadCeiling',
          sampledRequestsEnabled: true,
        },
      },
    ],
  });

  new CfnWebACLAssociation(stack, 'ApiRateLimitAssociation', {
    resourceArn: graphqlApiArn,
    webAclArn: acl.attrArn,
  });

  return acl;
}
