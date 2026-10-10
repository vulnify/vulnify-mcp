export const VERSION = '0.1.3';
export const SERVER_NAME = 'io.vulnify/mcp';
export const SERVER_TITLE = 'Vulnify';
export const WEBSITE_URL = 'https://www.vulnify.io';
export const SERVER_ICONS = [
  {
    src: 'https://raw.githubusercontent.com/vulnify/vulnify-mcp/main/assets/logo.svg',
    mimeType: 'image/svg+xml',
    sizes: ['any'],
  },
  {
    src: 'https://raw.githubusercontent.com/vulnify/vulnify-mcp/main/.github/assets/logo.png',
    mimeType: 'image/png',
    sizes: ['any'],
  },
] as const;
export const DECISIONS_URI = 'vulnify://docs/decisions';
export const DEFAULT_BASE_URL = 'https://api.vulnify.io';
export const DEFAULT_PORT = 8080;
/** Upper bound for get_decision's optional wait. Keeps one tool call inside typical client timeouts. */
export const MAX_WAIT_MS = 30_000;
export const DEFAULT_POLL_MS = 1_000;
export const MIN_POLL_MS = 200;
export const REQUEST_TIMEOUT_MS = 20_000;
/** Active introspection results are reused for at most this long, and never past exp. */
export const INTROSPECTION_CACHE_MS = 60_000;
/** A successful API-key check is reused for at most this long. */
export const API_KEY_CACHE_MS = 60_000;

/** Canonical MCP resource (RFC 8707). Discovery URLs use this host, not the request Host header. */
export const MCP_RESOURCE = 'https://mcp.vulnify.io/mcp';
export const OAUTH_ISSUER = 'https://api.vulnify.io';
export const PROTECTED_RESOURCE_METADATA_URL = 'https://mcp.vulnify.io/.well-known/oauth-protected-resource/mcp';

/** Scopes this MCP server asks for. The authorization server may advertise a wider set. */
export const MCP_OAUTH_SCOPES = ['decisions:read', 'decisions:write', 'policies:read', 'policies:test'] as const;
export const MCP_OAUTH_SCOPE = MCP_OAUTH_SCOPES.join(' ');

/**
 * Protected-resource metadata for https://mcp.vulnify.io/mcp.
 * scopes_supported is the least privilege the hosted tools use.
 * Served locally so discovery does not depend on the API.
 */
export const PROTECTED_RESOURCE_METADATA = {
  resource: MCP_RESOURCE,
  authorization_servers: [OAUTH_ISSUER],
  scopes_supported: [...MCP_OAUTH_SCOPES],
  bearer_methods_supported: ['header'],
} as const;

export const INSTRUCTIONS = [
  'Vulnify is a runtime authorization layer. The finalDecision field is the authoritative result: ALLOW, REVIEW, or BLOCK.',
  'check_action previews a decision. It skips the PII scan and records nothing.',
  'decide_action and check_mcp_tool_call record a decision. check_action is the preview and records nothing.',
  'REVIEW means a human decides. This server cannot approve or deny a review.',
  'When finalDecision is REVIEW, get_decision can poll until it is ALLOW or BLOCK.',
  'A tool error does not include finalDecision. finalDecision is present on a successful decision.',
].join(' ');

/** Instructions for an OAuth session, which does not list the API-key-only tools. */
export const OAUTH_INSTRUCTIONS = [
  'Vulnify is a runtime authorization layer. The finalDecision field is the authoritative result: ALLOW, REVIEW, or BLOCK.',
  'check_action previews a decision. It skips the PII scan and records nothing.',
  'decide_action records a decision. check_action is the preview and records nothing.',
  'REVIEW means a human decides. This server cannot approve or deny a review.',
  'When finalDecision is REVIEW, get_decision can poll until it is ALLOW or BLOCK.',
  'A tool error does not include finalDecision. finalDecision is present on a successful decision.',
].join(' ');
