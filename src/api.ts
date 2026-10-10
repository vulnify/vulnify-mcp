import { REQUEST_TIMEOUT_MS } from './constants.js';
import { VulnifyApiError, formatApiError } from './errors.js';
import { redact } from './redact.js';
import type { PlanPolicyChangesInput, PolicySpec } from './schemas.js';

export interface VulnifyClientOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface ApiResult {
  body: unknown;
  headers: Headers;
}

function defined(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/**
 * Body for POST /v1/policies/apply. dryRun is always true and cannot be overridden.
 */
export function buildPlanBody(input: PlanPolicyChangesInput & { dryRun?: unknown }): { policies: PolicySpec[]; prune?: boolean; dryRun: true } {
  const body: { policies: PolicySpec[]; prune?: boolean; dryRun: true } = {
    policies: input.policies,
    dryRun: true,
  };
  if (input.prune !== undefined) body.prune = input.prune;
  body.dryRun = true;
  return body;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

export class VulnifyClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: VulnifyClientOptions) {
    if (!options.apiKey) throw new Error('Vulnify API key is required.');
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  listPolicies(): Promise<ApiResult> {
    return this.request('GET', '/v1/policies');
  }

  testPolicies(body: unknown): Promise<ApiResult> {
    return this.request('POST', '/v1/policies/test', body);
  }

  planPolicyChanges(input: PlanPolicyChangesInput): Promise<ApiResult> {
    return this.request('POST', '/v1/policies/apply', buildPlanBody(input));
  }

  createEvent(body: Record<string, unknown>, idempotencyKey?: string): Promise<ApiResult> {
    return this.request('POST', '/v1/events', defined(body), idempotencyKey);
  }

  getEvent(id: string): Promise<ApiResult> {
    return this.request('GET', `/v1/events/${encodeURIComponent(id)}`);
  }

  checkMcpToolCall(body: Record<string, unknown>, idempotencyKey?: string): Promise<ApiResult> {
    return this.request('POST', '/v1/gateway/mcp', defined(body), idempotencyKey);
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<ApiResult> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: timeout.signal,
      });
      const parsed = await readBody(response);
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        const message = formatApiError(response.status, parsed, path);
        const withRetry = response.status === 429 && retryAfter ? `${message} Retry-After: ${redact(retryAfter)}.` : message;
        throw new VulnifyApiError(response.status, withRetry, retryAfter);
      }
      return { body: parsed, headers: response.headers };
    } catch (err) {
      if (err instanceof VulnifyApiError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new VulnifyApiError(0, 'Vulnify did not respond before the timeout.');
      }
      const detail = err instanceof Error ? redact(err.message) : 'network error';
      throw new VulnifyApiError(0, `Vulnify could not be reached (${detail}).`);
    } finally {
      clearTimeout(timer);
    }
  }
}
