import { redact } from './redact.js';

export class VulnifyApiError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;

  constructor(status: number, message: string, retryAfter: string | null = null) {
    super(message);
    this.name = 'VulnifyApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const COMMERCE_URL = /https?:\/\/[^\s)\]"'<>]+/gi;
const COMMERCE_HINT = /checkout|upgrade|billing|pricing|subscribe|payment|\bplans?\b/i;
const COMMERCE_KEY = /^(checkout|upgrade|billing|pricing|subscribe|payment)(url|uri|link|href)?$/i;

function isCommerceLink(url: string): boolean {
  const trimmed = url.trim().replace(/[),.;]+$/g, '');
  try {
    const parsed = new URL(trimmed);
    return COMMERCE_HINT.test(`${parsed.hostname}${parsed.pathname}${parsed.search}`);
  } catch {
    return COMMERCE_HINT.test(trimmed);
  }
}

/** Removes checkout, upgrade, billing, and pricing links from text returned to a model. */
export function stripCommerceLinks(value: string): string {
  const withoutMarkdown = value.replace(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi, (match, url: string) =>
    isCommerceLink(url) ? '' : match,
  );
  return withoutMarkdown
    .replace(COMMERCE_URL, (url) => (isCommerceLink(url) ? '' : url))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;])/g, '$1')
    .trim();
}

/** Drops commerce links from a tool payload, including a field whose value is only that link. */
export function sanitizeToolPayload(value: unknown): unknown {
  if (typeof value === 'string') return stripCommerceLinks(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeToolPayload(item));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (COMMERCE_KEY.test(key)) continue;
    if (typeof item === 'string' && isCommerceLink(item)) continue;
    out[key] = sanitizeToolPayload(item);
  }
  return out;
}

function messageOf(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as { message?: unknown; error?: unknown };
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string' && record.error !== 'rate_limited' && record.error !== 'validation_error') {
    return record.error;
  }
  return '';
}

function fieldsOf(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const fields = (body as { fields?: unknown }).fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return '';
  return Object.entries(fields as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('; ');
}

function errorDescription(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as { error_description?: unknown; error?: unknown };
  if (typeof record.error_description === 'string') return record.error_description;
  if (typeof record.error === 'string') return record.error;
  return '';
}

function rateLimitMessage(path: string): string {
  if (path.startsWith('/v1/policies') || path.startsWith('/v1/mcp/policies')) {
    return 'Vulnify rate limit exceeded (429). Policy list, test, and plan calls are limited to 60 requests per minute per API key. Batch cases with test_policies instead of calling check_action in a loop.';
  }
  return 'Vulnify rate limit exceeded (429). Wait before retrying. Retry decide_action or check_mcp_tool_call with the same idempotencyKey so Vulnify does not record a second event.';
}

/**
 * Turns an API status into a tool error message. The API key is never included.
 * 401, 403, 413, and 429 are mapped explicitly.
 */
export function formatApiError(status: number, body: unknown, path: string): string {
  const apiMessage = stripCommerceLinks(redact(messageOf(body)));
  const fields = stripCommerceLinks(redact(fieldsOf(body)));

  switch (status) {
    case 401:
      if (path.startsWith('/v1/mcp/')) {
        return 'Vulnify rejected the access token (401). It is invalid, revoked, or expired.';
      }
      return 'Vulnify rejected the API key (401). It is missing, invalid, revoked, or expired.';
    case 403:
      if (path.startsWith('/v1/mcp/')) {
        const description = stripCommerceLinks(redact(errorDescription(body) || apiMessage));
        return `Vulnify refused this call (403). ${description || 'The access token cannot perform this action.'}`;
      }
      if (apiMessage.includes('org-wide LIVE')) {
        return 'Vulnify refused this call (403). plan_policy_changes requires an org-wide LIVE API key. A TEST key or an agent-bound key cannot plan policy changes.';
      }
      return `Vulnify refused this call (403). ${apiMessage || 'The key may be bound to another agent, or the caller IP is not on the key allowlist.'}`;
    case 413:
      return 'Vulnify rejected the body (413). JSON requests are limited to 200 KB. Shorten content or send fewer cases.';
    case 429:
      return rateLimitMessage(path);
    case 400:
      return `Vulnify rejected the request (400). ${fields || apiMessage || 'Check the agent, resource, and action.'}`;
    case 404:
      return `Vulnify could not find that record (404). ${apiMessage || 'The agent, resource, event, or route is unknown.'}`;
    default:
      return `Vulnify request failed (${status}). ${apiMessage || 'No error message was returned.'}`;
  }
}
