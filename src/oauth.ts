import {
  INTROSPECTION_CACHE_MS,
  MCP_OAUTH_SCOPE,
  MCP_RESOURCE,
  PROTECTED_RESOURCE_METADATA_URL,
  REQUEST_TIMEOUT_MS,
} from './constants.js';

const CACHE_LIMIT = 1024;

export type IntrospectionResult =
  | { ok: true; scopes: string[] }
  | { ok: false; reason: 'inactive' | 'unavailable' | 'unconfigured' };

interface CacheEntry {
  scopes: string[];
  validUntil: number;
}

export interface TokenIntrospectorOptions {
  baseUrl: string;
  secret?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/**
 * Validates `vln_oat_...` tokens with POST /oauth/introspect.
 * Active results are cached for at most 60 seconds and never past `exp`.
 * Inactive results are not cached. The introspection secret is not logged.
 */
export class TokenIntrospector {
  private readonly endpoint: string;
  private readonly secret: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: TokenIntrospectorOptions) {
    const baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.endpoint = `${baseUrl}/oauth/introspect`;
    const secret = options.secret?.trim() ?? '';
    this.secret = secret.length > 0 && !/\s/.test(secret) ? secret : undefined;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async introspect(token: string): Promise<IntrospectionResult> {
    const now = this.now();
    const cached = this.read(token, now);
    if (cached) return { ok: true, scopes: [...cached.scopes] };
    if (!this.secret) return { ok: false, reason: 'unconfigured' };

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.secret}`,
          'Cache-Control': 'no-store',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token }).toString(),
        signal: timeout.signal,
      });
      if (response.status !== 200) return { ok: false, reason: 'unavailable' };
      const body = (await response.json()) as unknown;
      const active = parseActive(body, now);
      if (!active) return { ok: false, reason: 'inactive' };
      this.store(token, active.scopes, active.exp, now);
      return { ok: true, scopes: [...active.scopes] };
    } catch {
      return { ok: false, reason: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }

  private read(token: string, now: number): CacheEntry | undefined {
    const hit = this.cache.get(token);
    if (!hit) return undefined;
    if (now >= hit.validUntil) {
      this.cache.delete(token);
      return undefined;
    }
    return hit;
  }

  private store(token: string, scopes: string[], exp: number | undefined, now: number): void {
    const expMs = exp === undefined ? Number.POSITIVE_INFINITY : exp * 1000;
    const validUntil = Math.min(now + INTROSPECTION_CACHE_MS, expMs);
    if (!(validUntil > now)) return;
    this.cache.delete(token);
    this.cache.set(token, { scopes: [...scopes], validUntil });
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

export function wwwAuthenticate(error?: 'invalid_token' | 'invalid_request'): string {
  const header = `Bearer realm="${MCP_RESOURCE}", resource_metadata="${PROTECTED_RESOURCE_METADATA_URL}", scope="${MCP_OAUTH_SCOPE}"`;
  return error ? `${header}, error="${error}"` : header;
}

function parseScopes(scope: unknown): string[] {
  if (typeof scope !== 'string') return [];
  return scope.split(/\s+/).filter((part) => part.length > 0);
}

function audienceAllows(aud: unknown): boolean {
  if (aud === undefined) return true;
  if (typeof aud === 'string') return aud === MCP_RESOURCE;
  if (Array.isArray(aud)) return aud.includes(MCP_RESOURCE);
  return false;
}

function parseActive(body: unknown, now: number): { scopes: string[]; exp: number | undefined } | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as { active?: unknown; scope?: unknown; exp?: unknown; aud?: unknown };
  if (record.active !== true) return undefined;
  if (!audienceAllows(record.aud)) return undefined;
  const exp = typeof record.exp === 'number' && Number.isFinite(record.exp) ? record.exp : undefined;
  if (exp !== undefined && now >= exp * 1000) return undefined;
  return { scopes: parseScopes(record.scope), exp };
}
