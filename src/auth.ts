export type HeaderValue = string | string[] | undefined;
export type HeaderMap = Record<string, HeaderValue>;

export type ApiKeyRead =
  | { ok: true; apiKey: string }
  | { ok: false; message: string; reason: 'missing' | 'malformed' };

export type HttpCredential =
  | { ok: true; kind: 'api_key'; apiKey: string }
  | { ok: true; kind: 'oauth'; accessToken: string }
  | { ok: false; message: string; challenge: 'missing' | 'invalid_request' | 'invalid_token' };

const OAUTH_ACCESS_TOKEN = /^vln_oat_\S+$/;
const API_KEY = /^vln_(?:live|test)_\S+$/;

function single(value: HeaderValue): { ok: true; value: string } | { ok: false; message: string; reason: 'malformed' } | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length !== 1) return { ok: false, message: 'Send the API key in a single header value.', reason: 'malformed' };
    return { ok: true, value: value[0] ?? '' };
  }
  return { ok: true, value };
}

function parseBearer(header: string): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match?.[1];
}

function acceptableKey(key: string): boolean {
  return key.length > 0 && key.length <= 512 && /^\S+$/.test(key);
}

/**
 * Reads the per-request API key. Accepts `Authorization: Bearer <key>` or `X-Vulnify-Key`.
 * Never returns a key that contains whitespace. Does not log.
 */
export function readApiKey(headers: HeaderMap): ApiKeyRead {
  const authorization = single(headers.authorization ?? headers.Authorization);
  if (authorization && !authorization.ok) return authorization;
  const alternate = single(headers['x-vulnify-key'] ?? headers['X-Vulnify-Key']);
  if (alternate && !alternate.ok) return alternate;

  let bearer: string | undefined;
  if (authorization?.ok) {
    bearer = parseBearer(authorization.value);
    if (!bearer) {
      return { ok: false, message: 'Authorization must be a Bearer token: Bearer <api-key>.', reason: 'malformed' };
    }
  }

  const headerKey = alternate?.ok ? alternate.value.trim() : undefined;
  if (bearer && headerKey && bearer !== headerKey) {
    return { ok: false, message: 'Authorization and X-Vulnify-Key do not match.', reason: 'malformed' };
  }

  const apiKey = bearer ?? headerKey;
  if (!apiKey) {
    return {
      ok: false,
      reason: 'missing',
      message: 'Send a Vulnify API key as Authorization: Bearer <key> or X-Vulnify-Key: <key>.',
    };
  }
  if (!acceptableKey(apiKey)) {
    return { ok: false, message: 'The API key is empty or malformed.', reason: 'malformed' };
  }
  return { ok: true, apiKey };
}

/**
 * Classifies a per-request credential.
 * `vln_oat_...` is an OAuth access token. `vln_live_...` and `vln_test_...` are API keys.
 * A refresh token (`vln_ort_...`), a `vln_oac_...` credential, or any other format is rejected
 * so the client receives 401 and can sign in again.
 */
export function readHttpCredential(headers: HeaderMap): HttpCredential {
  const read = readApiKey(headers);
  if (!read.ok) {
    if (read.reason === 'missing') {
      return {
        ok: false,
        challenge: 'missing',
        message: 'Sign in with Vulnify, or send an API key as Authorization: Bearer <key> or X-Vulnify-Key: <key>.',
      };
    }
    return { ok: false, challenge: 'invalid_request', message: read.message };
  }
  if (OAUTH_ACCESS_TOKEN.test(read.apiKey)) {
    return { ok: true, kind: 'oauth', accessToken: read.apiKey };
  }
  if (API_KEY.test(read.apiKey)) {
    return { ok: true, kind: 'api_key', apiKey: read.apiKey };
  }
  return {
    ok: false,
    challenge: 'invalid_token',
    message:
      'This credential cannot call the MCP server. Sign in with Vulnify, or send an access token (vln_oat_...) or an API key (vln_live_... or vln_test_...).',
  };
}
