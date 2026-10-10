import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_POLL_MS } from './constants.js';
import { sanitizeToolPayload, stripCommerceLinks } from './errors.js';
import { redact } from './redact.js';
import {
  checkActionInput,
  checkMcpToolCallInput,
  decideActionInput,
  getDecisionInput,
  listPoliciesInput,
  planPolicyChangesInput,
  testPoliciesInput,
  type CheckActionInput,
  type CheckMcpToolCallInput,
  type DecideActionInput,
  type GetDecisionInput,
} from './schemas.js';
import type { VulnifyClient } from './api.js';

export interface ToolRuntime {
  client: VulnifyClient;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** False because every tool acts on the caller's own Vulnify organization. */
const OPEN_WORLD = false;

function annotations(title: string, readOnly: boolean, idempotent: boolean): ToolAnnotations {
  return {
    title,
    readOnlyHint: readOnly,
    destructiveHint: false,
    idempotentHint: idempotent,
    openWorldHint: OPEN_WORLD,
  };
}

function toolResult(value: Record<string, unknown>): CallToolResult {
  const clean = sanitizeToolPayload(value) as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: JSON.stringify(clean, null, 2) }],
    structuredContent: clean,
  };
}

function toolError(err: unknown): CallToolResult {
  const message = err instanceof Error ? redact(err.message) : 'Vulnify request failed.';
  return { isError: true, content: [{ type: 'text', text: stripCommerceLinks(message) }] };
}

async function run(fn: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    return toolResult(await fn());
  } catch (err) {
    return toolError(err);
  }
}

function asRecord(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) return { ...(body as Record<string, unknown>) };
  return { body };
}

function replayed(headers: Headers): boolean {
  return headers.get('idempotent-replay') === 'true';
}

function finalDecisionOf(body: Record<string, unknown>): string | undefined {
  return typeof body.finalDecision === 'string' ? body.finalDecision : undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function registerTools(server: McpServer, runtime: ToolRuntime): void {
  const now = runtime.now ?? Date.now;
  const sleep = runtime.sleep ?? defaultSleep;
  const { client } = runtime;

  server.registerTool(
    'check_action',
    {
      title: 'Check action',
      description:
        'Dry-run a proposed action against the organization policies (POST /v1/policies/test, one case, stored policies). This skips the PII scan and records nothing: no security event and no audit entry. There is no content field and no DLP scan. The result has no event id and no finalDecision. decide_action is the call that records a decision. Dry runs are limited to 60 requests per minute per key. test_policies covers up to 200 cases in one call.',
      inputSchema: checkActionInput,
      annotations: annotations('Check action', true, true),
    },
    async (input: CheckActionInput) =>
      run(async () => {
        const result = await client.testPolicies(
          {
            cases: [{ name: 'check_action', input }],
          },
          'check_action',
        );
        return asRecord(result.body);
      }),
  );

  server.registerTool(
    'decide_action',
    {
      title: 'Decide action',
      description:
        'Records a decision for a proposed action (POST /v1/events). This writes a security event and an audit entry, counts toward the organization quota, and may open a human review. The finalDecision field is the authoritative result. decision is what was stored and does not change when a review is resolved. finalDecision stays REVIEW until a human approves, denies, or the review expires. This tool does not approve the review. A REVIEW or BLOCK finalDecision means the action was not allowed. Optional content is scanned in memory and is not stored. An idempotencyKey makes a retry return the same event.',
      inputSchema: decideActionInput,
      annotations: annotations('Decide action', false, false),
    },
    async (input: DecideActionInput) =>
      run(async () => {
        const { idempotencyKey, ...event } = input;
        const result = await client.createEvent(event, idempotencyKey);
        return { ...asRecord(result.body), idempotentReplay: replayed(result.headers) };
      }),
  );

  server.registerTool(
    'get_decision',
    {
      title: 'Get decision',
      description:
        'Read a recorded decision (GET /v1/events/{id}), including a REVIEW. finalDecision is REVIEW while the review is pending, then ALLOW after approval or BLOCK after denial or expiry. decision itself does not change. The finalDecision field is the authoritative result. waitMs polls until finalDecision is ALLOW or BLOCK, or until the bounded wait elapses (30 seconds maximum). waitTimedOut is true when the wait ended and finalDecision is still REVIEW. This does not approve or deny the review.',
      inputSchema: getDecisionInput,
      annotations: annotations('Get decision', true, true),
    },
    async (input: GetDecisionInput) =>
      run(async () => {
        const waitMs = input.waitMs ?? 0;
        const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_MS;
        const started = now();
        let current = asRecord((await client.getEvent(input.id)).body);
        if (waitMs === 0 || finalDecisionOf(current) !== 'REVIEW') {
          return { ...current, waitTimedOut: false };
        }
        while (now() - started < waitMs) {
          const remaining = waitMs - (now() - started);
          if (remaining <= 0) break;
          await sleep(Math.min(pollIntervalMs, remaining));
          if (now() - started >= waitMs) break;
          current = asRecord((await client.getEvent(input.id)).body);
          if (finalDecisionOf(current) !== 'REVIEW') return { ...current, waitTimedOut: false };
        }
        return { ...current, waitTimedOut: finalDecisionOf(current) === 'REVIEW' };
      }),
  );

  server.registerTool(
    'list_policies',
    {
      title: 'List policies',
      description:
        'List the organization policies as code (GET /v1/policies). Returns apiVersion vulnify.io/v1 and policies sorted by name. Read-only. Any non-revoked API key of the organization may call it. Limited to 60 requests per minute per key.',
      inputSchema: listPoliciesInput,
      annotations: annotations('List policies', true, true),
    },
    async () =>
      run(async () => {
        const result = await client.listPolicies();
        return asRecord(result.body);
      }),
  );

  server.registerTool(
    'test_policies',
    {
      title: 'Test policies',
      description:
        'Evaluate up to 200 policy cases without recording an event (POST /v1/policies/test). When policies is omitted, the enabled stored policies are used. When policies is set, those proposed policies are evaluated instead and nothing is written. This skips the PII scan: cases have no content field. pass is null when a case omits expect. One call covers up to 200 cases. Limited to 60 requests per minute per key.',
      inputSchema: testPoliciesInput,
      annotations: annotations('Test policies', true, true),
    },
    async (input) =>
      run(async () => {
        const result = await client.testPolicies(input);
        return asRecord(result.body);
      }),
  );

  if (!client.usesApiKey()) return;

  server.registerTool(
    'plan_policy_changes',
    {
      title: 'Plan policy changes',
      description:
        'Diff policy creates, updates, and deletes without writing them (POST /v1/policies/apply). dryRun is forced to true and cannot be turned off. Nothing is stored and no audit entry is written. prune only marks missing policies for deletion in the plan. Requires an org-wide LIVE API key; a TEST key or an agent-bound key is refused with 403. This tool does not apply the plan.',
      inputSchema: planPolicyChangesInput,
      annotations: annotations('Plan policy changes', true, true),
    },
    async (input) =>
      run(async () => {
        const result = await client.planPolicyChanges(input);
        return asRecord(result.body);
      }),
  );

  server.registerTool(
    'check_mcp_tool_call',
    {
      title: 'Check MCP tool call',
      description:
        'Records a decision for a downstream MCP tool call (POST /v1/gateway/mcp). Vulnify maps the tool name to an action by substring and returns the same recorded decision as decide_action, including an id. This writes a security event and an audit entry. The tool arguments are not executed. The finalDecision field is the authoritative result. A REVIEW or BLOCK finalDecision means the downstream tool was not allowed. This server cannot approve the review. An idempotencyKey makes a retry return the same event.',
      inputSchema: checkMcpToolCallInput,
      annotations: annotations('Check MCP tool call', false, false),
    },
    async (input: CheckMcpToolCallInput) =>
      run(async () => {
        const { idempotencyKey, ...call } = input;
        const result = await client.checkMcpToolCall(call, idempotencyKey);
        return { ...asRecord(result.body), idempotentReplay: replayed(result.headers) };
      }),
  );
}
