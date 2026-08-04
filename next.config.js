/** @type {import('next').NextConfig} */

// Security headers applied to every response. Kept deliberately non-breaking:
// the CSP only sets directives that don't affect where scripts/styles/images/
// connections load from (frame-ancestors, base-uri, object-src, form-action),
// so it can't break Amplify/Cognito/S3/Stripe flows. A full source-restricting
// CSP is a recommended follow-up once tested against those hosts.
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
    ].join('; '),
  },
  // Force HTTPS for two years, including subdomains. The site is HTTPS-only
  // behind Amplify Hosting / CloudFront.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  // Don't let browsers MIME-sniff responses into a different content type.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Clickjacking protection (belt-and-braces with the CSP frame-ancestors).
  { key: 'X-Frame-Options', value: 'DENY' },
  // Send only the origin on cross-origin navigations.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Turn off browser features the app doesn't use.
  { key: 'Permissions-Policy', value: 'geolocation=(), browsing-topics=()' },
];

const nextConfig = {
  reactStrictMode: true,
  images: {
    // Photos are served from signed S3 URLs; allow any S3 host.
    remotePatterns: [
      { protocol: 'https', hostname: '**.amazonaws.com' },
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
