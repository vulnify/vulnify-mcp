export const VERSION = '0.1.4';
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
  'When to call: before you take a consequential action with any tool or connector in this session, call decide_action first. Consequential means sending an email or message, exporting or sharing data outside the organization, deleting data, writing to production, customer, or financial records, making a payment, or writing to an external API. Reads and drafts that stay with the user do not need a call.',
  'Describe the action you are about to take: agent (your agent name, for example claude), action, resource, destination, and records when known.',
  'How to act on finalDecision: ALLOW means proceed. REVIEW means a person decides: hold the action, tell the user it is waiting for approval in Vulnify, and use get_decision with the event id to check again. BLOCK means skip the action and tell the user the reasons.',
  'Right after the user connects Vulnify, offer one sample: call decide_action once with an illustrative action (for example agent claude, action send_email, resource customer_list, destination an external address) and show the user the finalDecision and reasons. It records one real decision in their organization and registers that agent and resource, which check_action and test_policies need. Say it is a sample.',
  'If a result has account.message, pass it on to the user. A 403 with code EMAIL_NOT_VERIFIED means the account has to confirm its email before going further: tell the user, do not treat it as a decision, and do not retry.',
  'A tool error is not an ALLOW. Hold the action and tell the user.',
  'Use check_action only for what-if questions when you are not about to act. It skips the PII scan and records nothing.',
  'This is guidance for the model. Vulnify does not intercept other tools by itself; hooks or the Vulnify gateway enforce it.',
  'check_mcp_tool_call also records a decision, judged by a downstream MCP tool name.',
  'REVIEW cannot be approved or denied through this server.',
].join(' ');

/** Instructions for an OAuth session, which does not list the API-key-only tools. */
export const OAUTH_INSTRUCTIONS = [
  'Vulnify is a runtime authorization layer. The finalDecision field is the authoritative result: ALLOW, REVIEW, or BLOCK.',
  'When to call: before you take a consequential action with any tool or connector in this session, call decide_action first. Consequential means sending an email or message, exporting or sharing data outside the organization, deleting data, writing to production, customer, or financial records, making a payment, or writing to an external API. Reads and drafts that stay with the user do not need a call.',
  'Describe the action you are about to take: agent (your agent name, for example claude), action, resource, destination, and records when known.',
  'How to act on finalDecision: ALLOW means proceed. REVIEW means a person decides: hold the action, tell the user it is waiting for approval in Vulnify, and use get_decision with the event id to check again. BLOCK means skip the action and tell the user the reasons.',
  'Right after the user connects Vulnify, offer one sample: call decide_action once with an illustrative action (for example agent claude, action send_email, resource customer_list, destination an external address) and show the user the finalDecision and reasons. It records one real decision in their organization and registers that agent and resource, which check_action and test_policies need. Say it is a sample.',
  'If a result has account.message, pass it on to the user. A 403 with code EMAIL_NOT_VERIFIED means the account has to confirm its email before going further: tell the user, do not treat it as a decision, and do not retry.',
  'A tool error is not an ALLOW. Hold the action and tell the user.',
  'Use check_action only for what-if questions when you are not about to act. It skips the PII scan and records nothing.',
  'This is guidance for the model. Vulnify does not intercept other tools by itself; hooks or the Vulnify gateway enforce it.',
  'REVIEW cannot be approved or denied through this server.',
].join(' ');
