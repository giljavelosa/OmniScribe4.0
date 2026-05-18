import { createHash, randomBytes } from 'node:crypto';

/**
 * SMART on FHIR client — Unit 19.
 *
 * Provider-launched OAuth2 flow against NextGen (v1). Stub-mode pattern
 * matching Soniox / Bedrock / S3 / Daily.co: when FHIR_NEXTGEN_CLIENT_ID
 * is unset, the OAuth handshake is synthesized so the launch + callback
 * flow works end-to-end without a real EHR sandbox.
 */

const CLIENT_ID = process.env.FHIR_NEXTGEN_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.FHIR_NEXTGEN_CLIENT_SECRET ?? '';
const REDIRECT_URI =
  process.env.FHIR_NEXTGEN_REDIRECT_URI ?? 'http://localhost:3000/api/fhir/callback';

export const smartConfig = {
  isStubMode: !CLIENT_ID,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUri: REDIRECT_URI,
};

export const REQUIRED_SMART_SCOPES = [
  'launch',
  'launch/patient',
  'patient/Patient.read',
  'patient/Encounter.read',
  'patient/Observation.read',
  'patient/MedicationStatement.read',
  'patient/MedicationRequest.read',
  'patient/Condition.read',
  'patient/AllergyIntolerance.read',
  'patient/DiagnosticReport.read',
  'patient/Procedure.read',
  'offline_access',
] as const;

export type SmartConfiguration = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
};

export type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresInSeconds: number;
  patient?: string;
};

const STUB_AUTH_PATH = '/stub/oauth/authorize';
const STUB_TOKEN_PATH = '/stub/oauth/token';

// In-memory cache of resolved SMART configs, keyed by fhirBaseUrl.
// Cleared on server restart; 1h TTL chosen to balance freshness vs.
// pummeling NextGen's well-known endpoint.
const SMART_CONFIG_TTL_MS = 60 * 60 * 1000;
const configCache = new Map<string, { value: SmartConfiguration; expiresAt: number }>();

/**
 * Resolve the EHR's SMART configuration from its .well-known endpoint.
 * Cached per-process for 1h. In stub mode synthesizes a fake config
 * pointing at internal stub paths.
 */
export async function resolveSmartConfig(fhirBaseUrl: string): Promise<SmartConfiguration> {
  if (smartConfig.isStubMode) {
    return {
      authorizationEndpoint: `${fhirBaseUrl.replace(/\/+$/, '')}${STUB_AUTH_PATH}`,
      tokenEndpoint: `${fhirBaseUrl.replace(/\/+$/, '')}${STUB_TOKEN_PATH}`,
    };
  }
  const cached = configCache.get(fhirBaseUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const url = `${fhirBaseUrl.replace(/\/+$/, '')}/.well-known/smart-configuration`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`smart-configuration fetch returned ${res.status} for ${url}`);
  }
  const body = (await res.json()) as {
    authorization_endpoint?: string;
    token_endpoint?: string;
  };
  if (!body.authorization_endpoint || !body.token_endpoint) {
    throw new Error(`smart-configuration at ${url} missing required endpoints`);
  }
  const value: SmartConfiguration = {
    authorizationEndpoint: body.authorization_endpoint,
    tokenEndpoint: body.token_endpoint,
  };
  configCache.set(fhirBaseUrl, { value, expiresAt: Date.now() + SMART_CONFIG_TTL_MS });
  return value;
}

/** Generate a PKCE code_verifier + matching S256 code_challenge. The
 *  verifier is base64url(random32), 43 chars; the challenge is
 *  base64url(sha256(verifier)). */
export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Random opaque state for the OAuth `state` param. 32 bytes → 43 chars
 *  base64url; collision-resistant for any realistic session volume. */
export function generateStateToken(): string {
  return base64url(randomBytes(32));
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Exchange an authorization code for tokens. Stub-mode returns
 *  synthetic tokens that are still encrypted at rest by the caller. */
export async function exchangeAuthCode(opts: {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  if (smartConfig.isStubMode) {
    return synthesizeStubTokenResponse(opts.code);
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: smartConfig.redirectUri,
    client_id: smartConfig.clientId,
    code_verifier: opts.codeVerifier,
  });
  if (smartConfig.clientSecret) body.set('client_secret', smartConfig.clientSecret);
  const res = await fetch(opts.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token exchange returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return parseTokenResponse(await res.json());
}

/** Refresh an access token using a refresh token. Stub-mode returns
 *  fresh synthetic tokens. */
export async function refreshAccessToken(opts: {
  tokenEndpoint: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  if (smartConfig.isStubMode) {
    return synthesizeStubTokenResponse(`stub-refresh-${Date.now()}`);
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: smartConfig.clientId,
  });
  if (smartConfig.clientSecret) body.set('client_secret', smartConfig.clientSecret);
  const res = await fetch(opts.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token refresh returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return parseTokenResponse(await res.json());
}

function parseTokenResponse(raw: unknown): TokenResponse {
  const r = raw as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
    patient?: string;
  };
  if (!r.access_token || !r.refresh_token || typeof r.expires_in !== 'number') {
    throw new Error('token response missing required fields');
  }
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    scope: r.scope ?? REQUIRED_SMART_SCOPES.join(' '),
    expiresInSeconds: r.expires_in,
    patient: r.patient,
  };
}

function synthesizeStubTokenResponse(seed: string): TokenResponse {
  const accessToken = `stub-access-${createHash('sha256').update(`${seed}:access`).digest('base64url').slice(0, 32)}`;
  const refreshToken = `stub-refresh-${createHash('sha256').update(`${seed}:refresh`).digest('base64url').slice(0, 32)}`;
  return {
    accessToken,
    refreshToken,
    scope: REQUIRED_SMART_SCOPES.join(' '),
    expiresInSeconds: 3600,
    // Synthetic patient FHIR id so Unit 20's matching code path has something
    // to grip in tests. Real-mode pulls this from NextGen's token response.
    patient: 'stub-patient-fhir-id',
  };
}
