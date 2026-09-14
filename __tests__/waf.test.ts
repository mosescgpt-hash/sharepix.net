import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly } from './sourceGuards';
import {
  BROAD_RATE_LIMIT,
  LOOKUP_RATE_LIMIT,
  THROTTLED_OPERATION,
} from '../amplify/waf';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const waf = codeOnly(read('amplify', 'waf.ts'));

describe('it costs nothing until somebody decides it should', () => {
  it('does nothing at all without the flag', () => {
    // The only thing in this backend with a fixed monthly bill, so turning it
    // on is a decision with a number attached rather than an inherited default.
    expect(waf).toContain('if (!process.env.WAF_ENABLED) return null');
  });

  it('creates nothing before that check', () => {
    // A Web ACL that exists but is not associated still costs $5 a month and
    // protects nothing.
    const guard = waf.indexOf('WAF_ENABLED');
    expect(guard).toBeGreaterThan(-1);
    expect(waf.indexOf('new CfnWebACL')).toBeGreaterThan(guard);
    expect(waf.indexOf('new CfnWebACLAssociation')).toBeGreaterThan(guard);
  });

  it('associates the ACL rather than leaving it floating', () => {
    expect(waf).toContain('resourceArn: graphqlApiArn');
    expect(waf).toContain('webAclArn: acl.attrArn');
  });
});

describe('the rule that matters', () => {
  it('watches the one endpoint that confirms a guess', () => {
    expect(THROTTLED_OPERATION).toBe('findEventByCode');
    expect(waf).toContain('searchString: THROTTLED_OPERATION');
  });

  it('scopes the tight limit so it cannot break a gallery load', () => {
    // Without the scope-down the 100/minute rule would apply to every request
    // and a normal gallery would trip it.
    expect(waf).toContain('scopeDownStatement');
  });

  it('evaluates the tight rule before the broad one', () => {
    expect(waf).toContain("name: 'LookupOracle'");
    const tight = waf.indexOf("name: 'LookupOracle'");
    const broad = waf.indexOf("name: 'BroadCeiling'");
    expect(tight).toBeLessThan(broad);
  });

  it('leaves room for a real visitor under the broad ceiling', () => {
    // One call signs up to 600 keys (MAX_KEYS_PER_REQUEST), and a page load is
    // a handful of requests. 2,000 per five minutes is far above that.
    expect(BROAD_RATE_LIMIT).toBeGreaterThanOrEqual(1000);
  });

  it('sits at the floor AWS allows, and says so', () => {
    // Not a considered figure — WAF rejects a rate-based limit below 100.
    expect(LOOKUP_RATE_LIMIT).toBe(100);
    expect(read('amplify', 'waf.ts')).toMatch(/minimum for a\s*\n?\s*\* rate-based rule/);
  });

  it('is honest about what a rate limit cannot do', () => {
    // Per-IP limits do nothing against a thousand addresses. The keyspace is
    // the real mitigation and the header should not pretend otherwise.
    expect(read('amplify', 'waf.ts')).toMatch(/distributed attack/i);
  });
});

describe('it is regional, because AppSync is', () => {
  it('does not ask for CLOUDFRONT scope', () => {
    expect(waf).toContain("scope: 'REGIONAL'");
    expect(waf).not.toContain("scope: 'CLOUDFRONT'");
  });

  it('allows by default and blocks by rule', () => {
    // A default-block ACL on a public API takes the site down.
    expect(waf).toContain('defaultAction: { allow: {} }');
  });
});
