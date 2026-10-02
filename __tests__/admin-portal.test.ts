import { groupsForToken, hasTotp } from '../amplify/auth/admin-mfa-gate/gate';
import { codeOnly, readSource } from './sourceGuards';

/**
 * The admin portal: admin powers require an authenticator app, and the
 * portal is installable but unlisted.
 */

describe('the admin MFA gate', () => {
  it('leaves non-admins alone', () => {
    expect(groupsForToken([], false)).toBeNull();
    expect(groupsForToken(['SOMETHING'], null)).toBeNull();
  });

  it('keeps ADMINS for an admin with an authenticator app', () => {
    expect(groupsForToken(['ADMINS'], true)).toBeNull();
  });

  it('withholds ADMINS from an admin without one, keeping other groups', () => {
    expect(groupsForToken(['ADMINS', 'OTHER'], false)).toEqual(['OTHER']);
  });

  it('fails closed on admin powers when the check itself fails', () => {
    expect(groupsForToken(['ADMINS'], null)).toEqual([]);
  });

  it('counts only an authenticator app, not SMS', () => {
    expect(hasTotp(['SOFTWARE_TOKEN_MFA'])).toBe(true);
    expect(hasTotp(['SMS_MFA'])).toBe(false);
    expect(hasTotp(undefined)).toBe(false);
  });

  it('never throws, so a fault cannot block every sign-in', () => {
    const handler = codeOnly(readSource('amplify/auth/admin-mfa-gate/handler.ts'));
    expect(handler).toContain('} catch (error) {');
    expect(handler).not.toMatch(/throw /);
  });

  it('is wired as the pool’s pre-token-generation trigger', () => {
    const auth = codeOnly(readSource('amplify/auth/resource.ts'));
    expect(auth).toContain('preTokenGeneration: adminMfaGate');
    expect(auth).toContain("mode: 'OPTIONAL'");
    const backend = codeOnly(readSource('amplify/backend.ts'));
    expect(backend).toContain("actions: ['cognito-idp:AdminGetUser']");
  });
});

describe('the portal', () => {
  const page = readSource('pages/sp-hq.tsx');

  it('sits behind sign-in, and shows nothing until ADMINS is on the token', () => {
    expect(page).toContain('const GatedPortal = withHostAuth(AdminPortal');
    expect(page).toContain("{state === 'admin' ? (");
    expect(page).toContain('await isGlobalAdmin()');
  });

  it('installs as its own app, scoped to its own path', () => {
    const manifest = JSON.parse(readSource('public/hq.webmanifest'));
    expect(manifest.start_url).toBe('/sp-hq');
    expect(manifest.scope).toBe('/sp-hq');
    expect(manifest.display).toBe('standalone');
    expect(page).toContain('<link key="manifest" rel="manifest" href="/hq.webmanifest" />');
    expect(readSource('pages/_app.tsx')).toContain('<link key="manifest" rel="manifest"');
  });

  it('is noindex in markup and in a header', () => {
    expect(page).toContain('<Layout title="Admin" noindex>');
    // Outside the sign-in wrapper, so a signed-out visitor's page carries it.
    const outer = page.slice(page.indexOf('export default function AdminPortalPage'));
    expect(outer).toContain('content="noindex, nofollow, noarchive"');
    expect(outer).toContain('href="/hq.webmanifest"');
    const config = readSource('next.config.js');
    expect(config).toContain("['/sp-hq', '/hq.webmanifest']");
    expect(config).toContain("'X-Robots-Tag', value: 'noindex, nofollow, noarchive'");
  });

  it('is linked from nowhere', () => {
    for (const file of ['components/Navbar.tsx', 'components/Layout.tsx', 'pages/global-admin.tsx', 'public/sitemap.xml']) {
      expect(readSource(file)).not.toContain('/sp-hq');
    }
  });
});
