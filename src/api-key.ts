import { createHash } from 'node:crypto';
import { API_KEY_CACHE_MS, REQUEST_TIMEOUT_MS } from './constants.js';

const CACHE_LIMIT = 1024;

export type ApiKeyCheck = { ok: true } | { ok: false; reason: 'invalid' | 'unavailable' };

interface CacheEntry {
  validUntil: number;
}

export interface ApiKeyCheckerOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** SHA-256 hex of the key. The cache stores this, not the key. */
export function apiKeyCacheKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Checks a `vln_live_...` or `vln_test_...` key with GET /v1/policies before the MCP
 * session starts. Any non-revoked key may list policies, and the call records nothing.
 * A 200 is cached for at most 60 seconds. A 401 is not cached. A 403 means the key was
 * recognized and the caller IP is outside the allowlist, so the key is accepted and the
 * tool call reports that refusal. Other failures are unavailable and are not cached.
 */
export class ApiKeyChecker {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: ApiKeyCheckerOptions) {
    const baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.endpoint = `${baseUrl}/v1/policies`;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async check(apiKey: string): Promise<ApiKeyCheck> {
    const now = this.now();
    const id = apiKeyCacheKey(apiKey);
    if (this.read(id, now)) return { ok: true };

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Cache-Control': 'no-store',
        },
        signal: timeout.signal,
      });
      await response.arrayBuffer().catch(() => undefined);
      if (response.status >= 200 && response.status < 300) {
        this.store(id, now);
        return { ok: true };
      }
      if (response.status === 403) {
        this.store(id, now);
        return { ok: true };
      }
      if (response.status === 401) return { ok: false, reason: 'invalid' };
      return { ok: false, reason: 'unavailable' };
    } catch {
      return { ok: false, reason: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }

  private read(id: string, now: number): boolean {
    const hit = this.cache.get(id);
    if (!hit) return false;
    if (now >= hit.validUntil) {
      this.cache.delete(id);
      return false;
    }
    return true;
  }

  private store(id: string, now: number): void {
    const validUntil = now + API_KEY_CACHE_MS;
    this.cache.delete(id);
    this.cache.set(id, { validUntil });
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
