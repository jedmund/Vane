import path from 'node:path';
import pkg from './package.json' with { type: 'json' };

// Resolve the OIDC issuer origin at config build time so it can be allowed
// in connect-src and form-action. We parse via the URL constructor (not a
// string split) so a malformed env value fails loud here instead of leaking
// a broken header. If OIDC_ISSUER_URL is unset at build time (e.g. local
// `next build` without a real PocketID configured) we omit the origin and
// emit a warning; the CSP will still be valid, just without the IdP host,
// and the dev who hits this will see why.
function resolveOidcOrigin() {
  const raw = process.env.OIDC_ISSUER_URL;
  if (!raw || raw.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '[next.config] OIDC_ISSUER_URL not set; CSP connect-src/form-action will not include an IdP origin. Set it before deploying with OIDC.',
    );
    return null;
  }
  try {
    return new URL(raw).origin;
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      `[next.config] OIDC_ISSUER_URL is not a valid URL (${raw}); CSP will be built without the IdP origin.`,
    );
    return null;
  }
}

const oidcOrigin = resolveOidcOrigin();
const connectSrc = ["'self'", ...(oidcOrigin ? [oidcOrigin] : [])].join(' ');
const formAction = ["'self'", ...(oidcOrigin ? [oidcOrigin] : [])].join(' ');

const cspDirectives = [
  "default-src 'self'",
  // Next.js 16 still injects a hydration shim inline. Until Next ships a
  // first-class nonce helper for App Router, we accept 'unsafe-inline' here.
  // TODO: revisit when Next.js exposes a server-rendered nonce hook.
  "script-src 'self' 'unsafe-inline'",
  // Headless UI and other component libraries inject runtime inline styles
  // (Floating UI positioning, transition states). Without 'unsafe-inline'
  // every popover and dialog breaks.
  "style-src 'self' 'unsafe-inline'",
  // Permissive img-src: chat responses pull from arbitrary URLs (favicons of
  // search results, OG images, etc). A tighter allowlist is future work; for
  // now keep the product working.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action ${formAction}`,
];

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: cspDirectives.join('; '),
  },
  // Redundant with frame-ancestors but cheap and catches old user agents.
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  // Two-year HSTS. Traefik already sets this in our homelab deploy; we
  // emit it here too so upstream/self-hosted users get the same protection
  // without extra config. No `preload` directive: opt-in to the preload
  // list is a one-way door and should be a conscious decision per deploy.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        hostname: 's2.googleusercontent.com',
      },
    ],
  },
  serverExternalPackages: [
    'pdf-parse',
    'playwright',
    'officeparser',
    'file-type',
  ],
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/@napi-rs/canvas/**',
      './node_modules/@napi-rs/canvas-linux-x64-gnu/**',
      './node_modules/@napi-rs/canvas-linux-x64-musl/**',
    ],
  },
  env: {
    NEXT_PUBLIC_VERSION: pkg.version,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
