export type HeaderValue = string | string[] | undefined;
export type HeaderMap = Record<string, HeaderValue>;

export type ApiKeyRead =
  | { ok: true; apiKey: string }
  | { ok: false; message: string };

function single(value: HeaderValue): { ok: true; value: string } | { ok: false; message: string } | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length !== 1) return { ok: false, message: 'Send the API key in a single header value.' };
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
      return { ok: false, message: 'Authorization must be a Bearer token: Bearer <api-key>.' };
    }
  }

  const headerKey = alternate?.ok ? alternate.value.trim() : undefined;
  if (bearer && headerKey && bearer !== headerKey) {
    return { ok: false, message: 'Authorization and X-Vulnify-Key do not match.' };
  }

  const apiKey = bearer ?? headerKey;
  if (!apiKey) {
    return {
      ok: false,
      message: 'Send a Vulnify API key as Authorization: Bearer <key> or X-Vulnify-Key: <key>.',
    };
  }
  if (!acceptableKey(apiKey)) {
    return { ok: false, message: 'The API key is empty or malformed.' };
  }
  return { ok: true, apiKey };
}
