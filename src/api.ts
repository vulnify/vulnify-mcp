import { REQUEST_TIMEOUT_MS } from './constants.js';
import { VulnifyApiError, formatApiError } from './errors.js';
import { redact } from './redact.js';
import type { PlanPolicyChangesInput, PolicySpec } from './schemas.js';

export interface OAuthAccess {
  accessToken: string;
  scopes: readonly string[];
}

export interface VulnifyClientOptions {
  /** API key (`vln_live_...` or `vln_test_...`). Omit when `oauth` is set. */
  apiKey?: string;
  /** User access token. Calls `/v1/mcp/*` and enforces the token's scopes. */
  oauth?: OAuthAccess;
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

function oauthApiKeyOnly(tool: string): string {
  if (tool === 'plan_policy_changes') {
    return 'plan_policy_changes requires a Vulnify API key (vln_live_... or vln_test_...). An OAuth access token cannot plan policy changes because the API has no /v1/mcp route for policy apply.';
  }
  if (tool === 'check_mcp_tool_call') {
    return 'check_mcp_tool_call requires a Vulnify API key (vln_live_... or vln_test_...). An OAuth access token cannot call the MCP gateway because the API has no /v1/mcp route for it.';
  }
  return `${tool} requires a Vulnify API key (vln_live_... or vln_test_...). An OAuth access token cannot call it because the API has no /v1/mcp route for this tool.`;
}

const REVIEWS_OAUTH_ONLY =
  'Reviews can only be resolved by a signed-in person (Vulnify connector with OAuth). An API key cannot approve or deny.';

export class VulnifyClient {
  private readonly authorization: string;
  private readonly mode: 'api_key' | 'oauth';
  private readonly scopes: ReadonlySet<string>;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: VulnifyClientOptions) {
    if (options.oauth && options.apiKey) {
      throw new Error('Pass either an API key or an OAuth access token.');
    }
    if (options.oauth) {
      if (!options.oauth.accessToken) throw new Error('OAuth access token is required.');
      this.mode = 'oauth';
      this.authorization = `Bearer ${options.oauth.accessToken}`;
      this.scopes = new Set(options.oauth.scopes);
    } else {
      if (!options.apiKey) throw new Error('Vulnify API key is required.');
      this.mode = 'api_key';
      this.authorization = `Bearer ${options.apiKey}`;
      this.scopes = new Set();
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /** True for `vln_live_...` and `vln_test_...` sessions, including stdio. */
  usesApiKey(): boolean {
    return this.mode === 'api_key';
  }

  listPolicies(): Promise<ApiResult> {
    return this.invoke('list_policies', 'policies:read', 'GET', '/v1/policies', '/v1/mcp/policies');
  }

  testPolicies(body: unknown, tool: 'check_action' | 'test_policies' = 'test_policies'): Promise<ApiResult> {
    return this.invoke(tool, 'policies:test', 'POST', '/v1/policies/test', '/v1/mcp/policies/test', body);
  }

  planPolicyChanges(input: PlanPolicyChangesInput): Promise<ApiResult> {
    return this.invoke('plan_policy_changes', null, 'POST', '/v1/policies/apply', null, buildPlanBody(input));
  }

  createEvent(body: Record<string, unknown>, idempotencyKey?: string): Promise<ApiResult> {
    return this.invoke('decide_action', 'decisions:write', 'POST', '/v1/events', '/v1/mcp/events', defined(body), idempotencyKey);
  }

  getEvent(id: string): Promise<ApiResult> {
    const encoded = encodeURIComponent(id);
    return this.invoke('get_decision', 'decisions:read', 'GET', `/v1/events/${encoded}`, `/v1/mcp/events/${encoded}`);
  }

  /** OAuth only: the API has no API-key route for reviews. */
  listReviews(limit: number): Promise<ApiResult> {
    if (this.mode === 'api_key') throw new Error(REVIEWS_OAUTH_ONLY);
    return this.invoke('list_pending_reviews', 'reviews:read', 'GET', '', `/v1/mcp/reviews?status=PENDING&limit=${limit}`);
  }

  resolveReview(id: string, decision: 'approve' | 'deny', body: { note?: string; mfaCode?: string }): Promise<ApiResult> {
    if (this.mode === 'api_key') throw new Error(REVIEWS_OAUTH_ONLY);
    const path = `/v1/mcp/reviews/${encodeURIComponent(id)}/${decision}`;
    return this.invoke('resolve_review', 'reviews:decide', 'POST', '', path, defined(body));
  }

  /** True when this session's token carries the scope (OAuth). API keys have no scopes. */
  hasScope(scope: string): boolean {
    return this.mode === 'oauth' && this.scopes.has(scope);
  }

  checkMcpToolCall(body: Record<string, unknown>, idempotencyKey?: string): Promise<ApiResult> {
    return this.invoke(
      'check_mcp_tool_call',
      'decisions:write',
      'POST',
      '/v1/gateway/mcp',
      null,
      defined(body),
      idempotencyKey,
    );
  }

  /**
   * API keys keep the `/v1/*` routes. OAuth tokens use `/v1/mcp/*` when that route exists.
   * `plan_policy_changes` and `check_mcp_tool_call` have no `/v1/mcp` route, so they stay API-key only.
   */
  private route(tool: string, scope: string | null, apiPath: string, mcpPath: string | null): string {
    if (this.mode === 'api_key') return apiPath;
    if (mcpPath === null) throw new Error(oauthApiKeyOnly(tool));
    if (!scope || !this.scopes.has(scope)) {
      throw new Error(`This access token cannot call ${tool}. It needs the ${scope ?? 'required'} scope.`);
    }
    return mcpPath;
  }

  private invoke(
    tool: string,
    scope: string | null,
    method: 'GET' | 'POST',
    apiPath: string,
    mcpPath: string | null,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<ApiResult> {
    return this.request(method, this.route(tool, scope, apiPath, mcpPath), body, idempotencyKey);
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<ApiResult> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: this.authorization,
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
