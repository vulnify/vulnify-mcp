export const VERSION = '0.1.1';
export const SERVER_NAME = 'io.vulnify/mcp';
export const SERVER_TITLE = 'Vulnify';
export const DEFAULT_BASE_URL = 'https://api.vulnify.io';
export const DEFAULT_PORT = 8080;
/** Upper bound for get_decision's optional wait. Keeps one tool call inside typical client timeouts. */
export const MAX_WAIT_MS = 30_000;
export const DEFAULT_POLL_MS = 1_000;
export const MIN_POLL_MS = 200;
export const REQUEST_TIMEOUT_MS = 20_000;

export const INSTRUCTIONS = [
  'Vulnify is a runtime authorization layer. Obey finalDecision: ALLOW, REVIEW, or BLOCK.',
  'check_action previews a decision. It skips the PII scan and records nothing.',
  'decide_action and check_mcp_tool_call record a real decision. Do not use them for a what-if question.',
  'REVIEW means a human must decide. This server cannot approve or deny a review.',
  'When finalDecision is REVIEW, poll get_decision until it is ALLOW or BLOCK before acting.',
  'A tool error is not an ALLOW. Do not run the action.',
].join(' ');
