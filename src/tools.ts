import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_POLL_MS } from './constants.js';
import { sanitizeToolPayload, stripCommerceLinks } from './errors.js';
import { redact } from './redact.js';
import {
  checkActionInput,
  checkMcpToolCallInput,
  decideActionInput,
  decisionOutput,
  getDecisionInput,
  getDecisionOutput,
  listPoliciesInput,
  planOutput,
  planPolicyChangesInput,
  policyListOutput,
  policyTestOutput,
  testPoliciesInput,
  listPendingReviewsInput,
  approveReviewInput,
  denyReviewInput,
  type ApproveReviewInput,
  type DenyReviewInput,
  type ListPendingReviewsInput,
  type CheckActionInput,
  type CheckMcpToolCallInput,
  type DecideActionInput,
  type GetDecisionInput,
} from './schemas.js';
import type { VulnifyClient } from './api.js';

export type ToolCallStatus = 'ok' | 'error';

export interface ToolRuntime {
  client: VulnifyClient;
  /** Called once per tool call with the tool name and outcome only (never arguments or results). */
  onToolCall?: (tool: string, status: ToolCallStatus) => void;
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

function annotations(title: string, readOnly: boolean, idempotent: boolean, destructive = false): ToolAnnotations {
  return {
    title,
    readOnlyHint: readOnly,
    destructiveHint: destructive,
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
  const register = ((name: string, config: unknown, handler: (...args: unknown[]) => Promise<CallToolResult>) =>
    (server.registerTool as (n: string, c: unknown, h: (...args: unknown[]) => Promise<CallToolResult>) => unknown).call(
      server,
      name,
      config,
      async (...args: unknown[]) => {
        let status: ToolCallStatus = 'error';
        try {
          const result = await handler(...args);
          status = result.isError ? 'error' : 'ok';
          return result;
        } finally {
          try {
            runtime.onToolCall?.(name, status);
          } catch {
            /* logging must never break a tool call */
          }
        }
      },
    )) as unknown as McpServer['registerTool'];

  register(
    'check_action',
    {
      title: 'Check action',
      description:
        'Use for what-if questions when you are not about to act. Dry-run a proposed action against the organization policies (POST /v1/policies/test, one case, stored policies). This skips the PII scan and records nothing: no security event and no audit entry. There is no content field and no DLP scan. The result has no event id and no finalDecision. decide_action is the call that records a decision. Dry runs are limited to 60 requests per minute per key. test_policies covers up to 200 cases in one call. Before the user confirms their email, each check_action counts toward the daily decision limit. account.message, when present, is a note for the user. 403 EMAIL_NOT_VERIFIED: the user must confirm their email; not a decision.',
      inputSchema: checkActionInput,
      outputSchema: policyTestOutput,
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

  register(
    'decide_action',
    {
      title: 'Decide action',
      description:
        'Call this before a consequential action with any tool or connector: sending an email or message, exporting or sharing data, deleting data, writing to production or financial records, payments, or external API writes. ALLOW: proceed. REVIEW: hold the action, tell the user it waits for approval in Vulnify, and check again with get_decision. BLOCK: skip the action and explain the reasons. Records a decision for a proposed action (POST /v1/events). This writes a security event and an audit entry, counts toward the organization quota, and may open a human review. The finalDecision field is the authoritative result. decision is what was stored and does not change when a review is resolved. finalDecision stays REVIEW until a human approves, denies, or the review expires. This tool does not approve the review. A REVIEW or BLOCK finalDecision means the action was not allowed. Optional content is scanned in memory and is not stored. An idempotencyKey makes a retry return the same event. Right after connecting, one sample call shows the user how decisions look. account.message, when present, is a note for the user. 403 EMAIL_NOT_VERIFIED: the user must confirm their email; not a decision.',
      inputSchema: decideActionInput,
      outputSchema: decisionOutput,
      annotations: annotations('Decide action', false, false),
    },
    async (input: DecideActionInput) =>
      run(async () => {
        const { idempotencyKey, ...event } = input;
        const result = await client.createEvent(event, idempotencyKey);
        return { ...asRecord(result.body), idempotentReplay: replayed(result.headers) };
      }),
  );

  register(
    'get_decision',
    {
      title: 'Get decision',
      description:
        'Read a recorded decision (GET /v1/events/{id}), including a REVIEW. finalDecision is REVIEW while the review is pending, then ALLOW after approval or BLOCK after denial or expiry. decision itself does not change. The finalDecision field is the authoritative result. waitMs polls until finalDecision is ALLOW or BLOCK, or until the bounded wait elapses (30 seconds maximum). waitTimedOut is true when the wait ended and finalDecision is still REVIEW. This does not approve or deny the review.',
      inputSchema: getDecisionInput,
      outputSchema: getDecisionOutput,
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

  register(
    'list_policies',
    {
      title: 'List policies',
      description:
        'List the organization policies as code (GET /v1/policies). Returns apiVersion vulnify.io/v1 and policies sorted by name. Read-only. Any non-revoked API key of the organization may call it. Limited to 60 requests per minute per key.',
      inputSchema: listPoliciesInput,
      outputSchema: policyListOutput,
      annotations: annotations('List policies', true, true),
    },
    async () =>
      run(async () => {
        const result = await client.listPolicies();
        return asRecord(result.body);
      }),
  );

  register(
    'test_policies',
    {
      title: 'Test policies',
      description:
        'Evaluate up to 200 policy cases without recording an event (POST /v1/policies/test). When policies is omitted, the enabled stored policies are used. When policies is set, those proposed policies are evaluated instead and nothing is written. This skips the PII scan: cases have no content field. pass is null when a case omits expect. One call covers up to 200 cases. Limited to 60 requests per minute per key. Agent and resource names must already exist; after a first decide_action they do. account.message, when present, is a note for the user. 403 EMAIL_NOT_VERIFIED: the user must confirm their email; not a decision.',
      inputSchema: testPoliciesInput,
      outputSchema: policyTestOutput,
      annotations: annotations('Test policies', true, true),
    },
    async (input) =>
      run(async () => {
        const result = await client.testPolicies(input);
        return asRecord(result.body);
      }),
  );

  if (!client.usesApiKey()) {
    registerReviewTools(register, client);
    return;
  }

  register(
    'plan_policy_changes',
    {
      title: 'Plan policy changes',
      description:
        'Diff policy creates, updates, and deletes without writing them (POST /v1/policies/apply). dryRun is forced to true and cannot be turned off. Nothing is stored and no audit entry is written. prune only marks missing policies for deletion in the plan. Requires an org-wide LIVE API key; a TEST key or an agent-bound key is refused with 403. This tool does not apply the plan.',
      inputSchema: planPolicyChangesInput,
      outputSchema: planOutput,
      annotations: annotations('Plan policy changes', true, true),
    },
    async (input) =>
      run(async () => {
        const result = await client.planPolicyChanges(input);
        return asRecord(result.body);
      }),
  );

  register(
    'check_mcp_tool_call',
    {
      title: 'Check MCP tool call',
      description:
        'Records a decision for a downstream MCP tool call (POST /v1/gateway/mcp). Vulnify maps the tool name to an action by substring and returns the same recorded decision as decide_action, including an id. This writes a security event and an audit entry. The tool arguments are not executed. The finalDecision field is the authoritative result. A REVIEW or BLOCK finalDecision means the downstream tool was not allowed. This server cannot approve the review. An idempotencyKey makes a retry return the same event. Right after connecting, one sample call shows the user how decisions look. account.message, when present, is a note for the user. 403 EMAIL_NOT_VERIFIED: the user must confirm their email; not a decision.',
      inputSchema: checkMcpToolCallInput,
      outputSchema: decisionOutput,
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

/** Fields of a pending review worth showing a person. Content and DLP matches are never part of it. */
function reviewSummary(item: Record<string, unknown>): Record<string, unknown> {
  const pick = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  return {
    id: item.id,
    agent: pick(item.agent).name ?? item.agentName ?? null,
    action: item.action ?? null,
    resource: pick(item.resource).name ?? item.resourceName ?? null,
    riskLevel: item.riskLevel ?? null,
    riskScore: item.riskScore ?? null,
    reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 3) : [],
    policy: pick(item.policy).name ?? null,
    createdAt: item.createdAt ?? null,
    reviewExpiresAt: item.reviewExpiresAt ?? null,
    approverRoles: pick(item.approval).approverRoles ?? null,
  };
}

/**
 * In-client review tools (OAuth sessions only).
 *
 * Safety model: an approval through this server must carry the approving person's current authenticator
 * code (mfaCode). The API enforces it for every risk level on /v1/mcp, so a model cannot approve by itself
 * even if it calls the tool without asking. The API also refuses approvals of actions the same person
 * requested (no self-approval: REVIEWs created through this connector need someone else), applies the
 * policy's approver roles, and writes an audit entry with via = oauth and the client id. Deny needs no
 * code because it can only make things stricter. Both tools are marked destructive so clients ask the
 * person before running them.
 */
function registerReviewTools(register: McpServer['registerTool'], client: VulnifyClient): void {
  if (client.hasScope('reviews:read')) {
    (register as unknown as (n: string, c: unknown, h: (input: ListPendingReviewsInput) => Promise<CallToolResult>) => void)(
      'list_pending_reviews',
      {
        title: 'List pending reviews',
        description:
          'List actions waiting for a person to approve or deny in the organization (GET /v1/mcp/reviews?status=PENDING). Read-only. Shows agent, action, resource, risk, reasons and expiry; never the action content. Use it when the person asks what is waiting for approval.',
        inputSchema: listPendingReviewsInput,
        annotations: annotations('List pending reviews', true, true),
      },
      async (input) =>
        run(async () => {
          const body = asRecord((await client.listReviews(input.limit ?? 20)).body);
          const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
          return { items: items.map(reviewSummary), total: body.total ?? items.length };
        }),
    );
  }
  if (!client.hasScope('reviews:decide')) return;
  (register as unknown as (n: string, c: unknown, h: (input: ApproveReviewInput) => Promise<CallToolResult>) => void)(
    'approve_review',
    {
      title: 'Approve review (needs the person)',
      description:
        'Approve a pending review on behalf of the person you are talking to (POST /v1/mcp/reviews/{id}/approve). Only call this after the person explicitly said to approve this specific review in this conversation. You must ask the person for the current 6-digit code from their authenticator app and pass it as mfaCode; never guess, reuse or make up a code. Vulnify refuses approvals without a valid code, approvals of actions the same person requested (another member must approve those), and approvals by roles the policy does not allow. Never approve an action you requested yourself in order to continue your own task. 403 MFA_REQUIRED_FOR_AI_APPROVAL: the person must turn on two-factor authentication in Vulnify or approve in the dashboard.',
      inputSchema: approveReviewInput,
      annotations: annotations('Approve review', false, false, true),
    },
    async (input) =>
      run(async () => {
        const result = await client.resolveReview(input.id, 'approve', { note: input.note, mfaCode: input.mfaCode });
        return reviewSummaryResolved(asRecord(result.body));
      }),
  );
  (register as unknown as (n: string, c: unknown, h: (input: DenyReviewInput) => Promise<CallToolResult>) => void)(
    'deny_review',
    {
      title: 'Deny review',
      description:
        'Deny a pending review on behalf of the person you are talking to (POST /v1/mcp/reviews/{id}/deny). Only call this after the person explicitly said to deny this specific review. The action stays blocked. Written to the audit log with the person as reviewer.',
      inputSchema: denyReviewInput,
      annotations: annotations('Deny review', false, false, true),
    },
    async (input) =>
      run(async () => {
        const result = await client.resolveReview(input.id, 'deny', { note: input.note });
        return reviewSummaryResolved(asRecord(result.body));
      }),
  );
}

function reviewSummaryResolved(body: Record<string, unknown>): Record<string, unknown> {
  return { ...reviewSummary(body), reviewStatus: body.reviewStatus ?? null, reviewedAt: body.reviewedAt ?? null };
}
