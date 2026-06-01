import {
  buildAuthorizationUrl,
  buildEndSessionUrl,
  authorizationCodeGrant,
  calculatePKCECodeChallenge,
  Configuration,
  discovery,
  fetchUserInfo,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';

// All OIDC-related env reads live here so a misconfigured deploy fails in one
// place with a clear error message.
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function getScopes(): string {
  return optionalEnv('OIDC_SCOPES') ?? 'openid profile email';
}

export function getRedirectUri(): string {
  return requireEnv('OIDC_REDIRECT_URI');
}

export function getSessionSecret(): string {
  const v = requireEnv('SESSION_SECRET');
  if (v.length < 16) {
    throw new Error('SESSION_SECRET must be at least 16 characters');
  }
  return v;
}

let configPromise: Promise<Configuration> | null = null;

// Lazy discovery: openid-client@6 hits /.well-known/openid-configuration on
// first call. Cache the resulting Configuration for the life of the process
// so we don't refetch on every request.
export function getOidcConfig(): Promise<Configuration> {
  if (!configPromise) {
    const issuer = new URL(requireEnv('OIDC_ISSUER_URL'));
    const clientId = requireEnv('OIDC_CLIENT_ID');
    const clientSecret = optionalEnv('OIDC_CLIENT_SECRET');
    configPromise = discovery(
      issuer,
      clientId,
      clientSecret ? { client_secret: clientSecret } : undefined,
    ).catch((err) => {
      // Reset so the next request retries discovery instead of permanently
      // caching the failure (PocketID may be temporarily down at boot).
      configPromise = null;
      throw err;
    });
  }
  return configPromise;
}

export interface AuthorizationStart {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export async function buildAuthorizationStart(): Promise<AuthorizationStart> {
  const config = await getOidcConfig();
  const state = randomState();
  const nonce = randomNonce();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

  const url = buildAuthorizationUrl(config, {
    redirect_uri: getRedirectUri(),
    scope: getScopes(),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return { url: url.toString(), state, nonce, codeVerifier };
}

export interface ExchangedTokens {
  accessToken: string;
  idTokenClaims: Record<string, unknown> | undefined;
  sub: string;
}

export async function exchangeCode(
  currentUrl: URL,
  expected: { state: string; nonce: string; codeVerifier: string },
): Promise<ExchangedTokens> {
  const config = await getOidcConfig();
  const tokens = await authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: expected.codeVerifier,
    expectedState: expected.state,
    expectedNonce: expected.nonce,
  });

  const claims = tokens.claims();
  const sub = claims?.sub;
  if (!sub) {
    throw new Error('OIDC response missing subject claim');
  }
  return {
    accessToken: tokens.access_token,
    idTokenClaims: claims,
    sub,
  };
}

export interface UserInfo {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

export async function fetchUserinfo(
  accessToken: string,
  expectedSub: string,
): Promise<UserInfo> {
  const config = await getOidcConfig();
  const info = await fetchUserInfo(config, accessToken, expectedSub);
  return info as UserInfo;
}

// Returns null when the provider does not advertise an end_session_endpoint.
// PocketID does, but be defensive so logout still clears local state on
// non-compliant IdPs.
export async function tryBuildEndSessionUrl(
  idTokenHint?: string,
  postLogoutRedirectUri?: string,
): Promise<string | null> {
  try {
    const config = await getOidcConfig();
    const params: Record<string, string> = {};
    if (idTokenHint) params.id_token_hint = idTokenHint;
    if (postLogoutRedirectUri) {
      params.post_logout_redirect_uri = postLogoutRedirectUri;
    }
    const url = buildEndSessionUrl(config, params);
    return url.toString();
  } catch {
    return null;
  }
}
