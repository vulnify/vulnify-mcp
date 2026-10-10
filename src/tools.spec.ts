import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildPlanBody, VulnifyClient } from './api.js';
import { DECISIONS_URI, DEFAULT_BASE_URL, INSTRUCTIONS, OAUTH_INSTRUCTIONS, VERSION, WEBSITE_URL } from './constants.js';
import { decisionOutput, getDecisionOutput, planOutput, policyListOutput, policyTestOutput } from './schemas.js';
import { createVulnifyServer } from './server.js';
import { readFileSync } from 'node:fs';

const API_KEY = 'vln_test_unit_key_do_not_log';
const BASE = 'https://api.vulnify.test';

const decision = {
  id: '6d1c2a3e-7b8f-4e9a-8c1d-2f3a4b5c6d7e',
  decision: 'REVIEW',
  finalDecision: 'REVIEW',
  evaluatedDecision: 'REVIEW',
  monitored: false,
  riskLevel: 'HIGH',
  riskScore: 80,
  reasons: ['export of customer records'],
  policy: { id: '9b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e', name: 'external-export' },
  dlpFindings: [],
  lgpdCategories: [],
  review: { status: 'PENDING', expiresAt: null, decidedAt: null, note: null },
  quotaExceeded: false,
  sandbox: true,
};

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function installFetch(handler: (captured: Captured) => Response | Promise<Response>): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    const captured: Captured = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: raw ? (JSON.parse(raw) as unknown) : undefined,
    };
    calls.push(captured);
    return handler(captured);
  };
  return { fetch: fetchImpl, calls };
}

async function withClient(
  fetchImpl: typeof fetch,
  runtime: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const client = new VulnifyClient({ apiKey: API_KEY, baseUrl: BASE, fetch: fetchImpl });
  const server = createVulnifyServer({ client, ...runtime });
  const mcp = new Client({ name: 'vulnify-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return {
    mcp,
    async close() {
      await mcp.close();
      await server.close();
    },
  };
}

function assertDescribed(schema: unknown, path: string): void {
  const root = schema && typeof schema === 'object' ? (schema as Record<string, unknown>) : {};
  walkSchema(schema, path, root, new Set());
}

function walkSchema(node: unknown, path: string, root: Record<string, unknown>, seen: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const ref = typeof (node as { $ref?: unknown }).$ref === 'string' ? (node as { $ref: string }).$ref : undefined;
  if (ref) {
    if (seen.has(ref)) return;
    seen.add(ref);
  }
  const current = (resolveRef(node, root) ?? node) as Record<string, unknown>;
  const properties = current.properties;
  if (properties && typeof properties === 'object') {
    for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
      assert.ok(hasDescription(value, root), `${path}.${key} needs a description`);
      walkSchema(value, `${path}.${key}`, root, seen);
    }
  }
  if ('items' in current) walkSchema(current.items, `${path}[]`, root, seen);
  for (const combiner of ['anyOf', 'oneOf', 'allOf']) {
    const list = current[combiner];
    if (Array.isArray(list)) {
      for (const item of list) walkSchema(item, path, root, seen);
    }
  }
}

function hasDescription(node: unknown, root: Record<string, unknown>): boolean {
  if (!node || typeof node !== 'object') return false;
  const current = node as Record<string, unknown>;
  if (typeof current.description === 'string' && current.description.length > 0) return true;
  const resolved = resolveRef(node, root);
  if (resolved && resolved !== node && typeof (resolved as { description?: unknown }).description === 'string') return true;
  for (const combiner of ['anyOf', 'oneOf', 'allOf']) {
    const list = current[combiner];
    if (Array.isArray(list) && list.some((item) => hasDescription(item, root))) return true;
  }
  return false;
}

function resolveRef(node: unknown, root: Record<string, unknown>): unknown {
  if (!node || typeof node !== 'object') return node;
  const ref = (node as { $ref?: unknown }).$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return node;
  let current: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (!current || typeof current !== 'object') return node;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function textOf(result: unknown): string {
  assert.ok(result && typeof result === 'object' && 'content' in result && Array.isArray(result.content), 'expected content');
  const block = (result.content as Array<{ type: string; text?: string }>).find((item) => item.type === 'text');
  assert.ok(block?.text, 'expected a text block');
  return block.text;
}

describe('plan body', () => {
  it('forces dryRun true even when the caller passes false', () => {
    const body = buildPlanBody({
      policies: [{ name: 'block-export', action: 'EXPORT', decision: 'BLOCK' }],
      prune: true,
      dryRun: false,
    });
    assert.equal(body.dryRun, true);
    assert.equal(body.prune, true);
    assert.equal(Object.hasOwn(body, 'dryRun'), true);
    assert.deepEqual(JSON.parse(JSON.stringify(body)).dryRun, true);
  });
});

describe('tools', () => {
  it('lists the five OAuth tools and keeps the API-key tools on an API-key session', async () => {
    const oauthClient = new VulnifyClient({
      baseUrl: BASE,
      oauth: { accessToken: 'vln_oat_unit_access_token', scopes: ['policies:read', 'policies:test', 'decisions:read', 'decisions:write'] },
      fetch: async () => jsonResponse(200, {}),
    });
    const server = createVulnifyServer({ client: oauthClient });
    const mcp = new Client({ name: 'oauth-tools', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    try {
      const names = (await mcp.listTools()).tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, ['check_action', 'decide_action', 'get_decision', 'list_policies', 'test_policies']);
      assert.equal(mcp.getInstructions(), OAUTH_INSTRUCTIONS);
      assert.deepEqual(
        (await mcp.listPrompts()).prompts.map((prompt) => prompt.name).sort(),
        ['guard_action', 'review_policies'],
      );
      assert.equal((await mcp.listResources()).resources[0]?.uri, DECISIONS_URI);
      assert.equal(mcp.getServerVersion()?.websiteUrl, WEBSITE_URL);
    } finally {
      await mcp.close();
      await server.close();
    }
  });

  it('publishes a title and the four behavior hints for every tool', async () => {
    const { fetch: fetchImpl } = installFetch(() => jsonResponse(200, { results: [] }));
    const { mcp, close } = await withClient(fetchImpl);
    try {
      const listed = await mcp.listTools();
      const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
      const expected: Record<string, { readOnly: boolean; idempotent: boolean; title: string }> = {
        check_action: { readOnly: true, idempotent: true, title: 'Check action' },
        decide_action: { readOnly: false, idempotent: false, title: 'Decide action' },
        get_decision: { readOnly: true, idempotent: true, title: 'Get decision' },
        list_policies: { readOnly: true, idempotent: true, title: 'List policies' },
        test_policies: { readOnly: true, idempotent: true, title: 'Test policies' },
        plan_policy_changes: { readOnly: true, idempotent: true, title: 'Plan policy changes' },
        check_mcp_tool_call: { readOnly: false, idempotent: false, title: 'Check MCP tool call' },
      };
      assert.deepEqual(Object.keys(expected).sort(), [...byName.keys()].sort());
      for (const [name, hint] of Object.entries(expected)) {
        const tool = byName.get(name);
        assert.ok(tool, name);
        assert.equal(tool.title, hint.title);
        assert.equal(tool.annotations?.title, hint.title);
        assert.equal(tool.annotations?.readOnlyHint, hint.readOnly);
        assert.equal(tool.annotations?.destructiveHint, false);
        assert.equal(tool.annotations?.idempotentHint, hint.idempotent);
        assert.equal(tool.annotations?.openWorldHint, false);
        assert.doesNotMatch(tool.description ?? '', /obey/i);
        assert.doesNotMatch(tool.description ?? '', /do not run/i);
      }
      assert.doesNotMatch(INSTRUCTIONS, /obey/i);
      assert.doesNotMatch(INSTRUCTIONS, /do not run/i);
      assert.doesNotMatch(OAUTH_INSTRUCTIONS, /obey/i);
      assert.doesNotMatch(OAUTH_INSTRUCTIONS, /check_mcp_tool_call/);
      assert.doesNotMatch(OAUTH_INSTRUCTIONS, /plan_policy_changes/);
      const plan = byName.get('plan_policy_changes');
      assert.equal(plan?.inputSchema.properties?.dryRun, undefined);
      assert.match(byName.get('check_action')?.description ?? '', /skips the PII scan/);
      assert.match(byName.get('check_action')?.description ?? '', /records nothing/);
      assert.match(byName.get('decide_action')?.description ?? '', /record/i);
      assert.match(byName.get('check_mcp_tool_call')?.description ?? '', /record/i);
      assert.match(byName.get('plan_policy_changes')?.description ?? '', /cannot be turned off/);
      for (const tool of listed.tools) {
        assert.ok(tool.outputSchema, tool.name);
        assert.notEqual(tool.outputSchema.additionalProperties, false, tool.name);
        assertDescribed(tool.inputSchema, tool.name);
      }
      const prompts = await mcp.listPrompts();
      const guard = prompts.prompts.find((prompt) => prompt.name === 'guard_action');
      const review = prompts.prompts.find((prompt) => prompt.name === 'review_policies');
      assert.ok(guard);
      assert.deepEqual(
        guard.arguments?.map((argument) => argument.name),
        ['agent', 'action', 'resource', 'destination', 'records'],
      );
      assert.deepEqual(
        guard.arguments?.filter((argument) => argument.required).map((argument) => argument.name),
        ['agent', 'action', 'resource'],
      );
      assert.ok(review);
      assert.equal(review.arguments, undefined);
      const resources = await mcp.listResources();
      assert.equal(resources.resources[0]?.uri, DECISIONS_URI);
      const read = await mcp.readResource({ uri: DECISIONS_URI });
      const resourceText = JSON.stringify(read);
      assert.match(resourceText, /finalDecision/);
      assert.match(resourceText, /ALLOW/);
      assert.match(resourceText, /REVIEW/);
      assert.match(resourceText, /BLOCK/);
      assert.doesNotMatch(resourceText, /obey/i);
      const guardText = JSON.stringify(
        await mcp.getPrompt({
          name: 'guard_action',
          arguments: {
            agent: 'SalesBot',
            action: 'EXPORT_DATA',
            resource: 'Customer Database',
            records: '12',
          },
        }),
      );
      assert.match(guardText, /SalesBot/);
      assert.match(guardText, /check_action/);
      assert.match(guardText, /ALLOW/);
      assert.match(guardText, /REVIEW/);
      assert.match(guardText, /BLOCK/);
      assert.doesNotMatch(guardText, /obey/i);
      const reviewText = JSON.stringify(await mcp.getPrompt({ name: 'review_policies' }));
      assert.match(reviewText, /list_policies/);
      assert.match(reviewText, /test_policies/);
    } finally {
      await close();
    }
  });

  it('accepts recorded API samples, including nulls and extra fields', () => {
    const recorded = {
      ...decision,
      policy: null,
      review: null,
      idempotentReplay: false,
      gateway: { route: 'customers' },
    };
    assert.equal(decisionOutput.safeParse(recorded).success, true);
    assert.equal(getDecisionOutput.safeParse({ ...recorded, waitTimedOut: true }).success, true);
    assert.equal(getDecisionOutput.safeParse(recorded).success, false);
    assert.equal(
      policyTestOutput.safeParse({
        results: [
          {
            name: 'check_action',
            decision: 'ALLOW',
            matchedPolicy: null,
            riskScore: 5,
            riskLevel: 'LOW',
            reasons: [],
            pass: null,
          },
        ],
      }).success,
      true,
    );
    assert.equal(policyTestOutput.safeParse({ results: [] }).success, true);
    assert.equal(policyTestOutput.safeParse({ results: [{ decision: 'ALLOW' }] }).success, false);
    assert.equal(
      policyListOutput.safeParse({
        apiVersion: 'vulnify.io/v1',
        policies: [{ name: 'block-export', id: '9b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e', updatedAt: '2026-01-01T00:00:00Z' }],
      }).success,
      true,
    );
    assert.equal(policyListOutput.safeParse({ apiVersion: 'vulnify.io/v1', policies: [] }).success, true);
    assert.equal(
      planOutput.safeParse({ dryRun: true, changes: [{ name: 'block-export', op: 'create', id: 'extra' }] }).success,
      true,
    );
    assert.equal(decisionOutput.safeParse({ id: recorded.id }).success, false);
  });

  it('check_action posts one dry-run case and does not send content or policies', async () => {
    const { fetch: fetchImpl, calls } = installFetch(() =>
      jsonResponse(200, {
        results: [
          {
            name: 'check_action',
            decision: 'ALLOW',
            matchedPolicy: null,
            riskScore: 5,
            riskLevel: 'LOW',
            reasons: [],
            pass: null,
          },
        ],
      }),
    );
    const { mcp, close } = await withClient(fetchImpl);
    try {
      const result = await mcp.callTool({
        name: 'check_action',
        arguments: {
          agent: 'SalesBot',
          action: 'EXPORT_DATA',
          resource: 'Customer Database',
          destination: 'EXTERNAL_EMAIL',
          recordsAffected: 12,
          containsSensitiveData: false,
        },
      });
      assert.equal(result.isError, undefined);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.method, 'POST');
      assert.equal(calls[0]?.url, `${BASE}/v1/policies/test`);
      assert.equal(calls[0]?.headers.get('authorization'), `Bearer ${API_KEY}`);
      const body = calls[0]?.body as { cases: unknown[]; policies?: unknown; content?: unknown };
      assert.equal(body.policies, undefined);
      assert.equal('content' in body, false);
      assert.equal(body.cases.length, 1);
      assert.equal(textOf(result).includes(API_KEY), false);
    } finally {
      await close();
    }
  });

  it('decide_action records an event and forwards the idempotency key', async () => {
    const { fetch: fetchImpl, calls } = installFetch(() => jsonResponse(200, { ...decision, decision: 'ALLOW', finalDecision: 'ALLOW' }, { 'Idempotent-Replay': 'true' }));
    const { mcp, close } = await withClient(fetchImpl);
    try {
      const result = await mcp.callTool({
        name: 'decide_action',
        arguments: {
          agent: 'SalesBot',
          action: 'EXPORT_DATA',
          resource: 'Customer Database',
          content: 'customer row',
          idempotencyKey: 'retry-1',
        },
      });
      assert.notEqual(result.isError, true);
      assert.equal(calls[0]?.url, `${BASE}/v1/events`);
      assert.equal(calls[0]?.headers.get('idempotency-key'), 'retry-1');
      const body = calls[0]?.body as { content?: string; idempotencyKey?: string };
      assert.equal(body.content, 'customer row');
      assert.equal(body.idempotencyKey, undefined);
      const parsed = JSON.parse(textOf(result)) as { idempotentReplay: boolean; finalDecision: string };
      assert.equal(parsed.idempotentReplay, true);
      assert.equal(parsed.finalDecision, 'ALLOW');
    } finally {
      await close();
    }
  });

  it('get_decision polls a REVIEW until finalDecision changes', async () => {
    let reads = 0;
    const { fetch: fetchImpl } = installFetch(() => {
      reads += 1;
      const finalDecision = reads < 3 ? 'REVIEW' : 'ALLOW';
      return jsonResponse(200, {
        ...decision,
        finalDecision,
        review: { ...decision.review, status: finalDecision === 'ALLOW' ? 'APPROVED' : 'PENDING' },
      });
    });
    let clock = 0;
    const { mcp, close } = await withClient(fetchImpl, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    try {
      const result = await mcp.callTool({
        name: 'get_decision',
        arguments: { id: decision.id, waitMs: 5_000, pollIntervalMs: 1_000 },
      });
      const parsed = JSON.parse(textOf(result)) as { finalDecision: string; waitTimedOut: boolean };
      assert.equal(parsed.finalDecision, 'ALLOW');
      assert.equal(parsed.waitTimedOut, false);
      assert.equal(reads, 3);
    } finally {
      await close();
    }
  });

  it('get_decision reports waitTimedOut when the review stays pending', async () => {
    let reads = 0;
    const { fetch: fetchImpl } = installFetch(() => {
      reads += 1;
      return jsonResponse(200, decision);
    });
    let clock = 0;
    const { mcp, close } = await withClient(fetchImpl, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    try {
      const result = await mcp.callTool({
        name: 'get_decision',
        arguments: { id: decision.id, waitMs: 2_000, pollIntervalMs: 1_000 },
      });
      const parsed = JSON.parse(textOf(result)) as { finalDecision: string; waitTimedOut: boolean };
      assert.equal(parsed.finalDecision, 'REVIEW');
      assert.equal(parsed.waitTimedOut, true);
      assert.ok(reads >= 2);
    } finally {
      await close();
    }
  });

  it('list_policies calls GET /v1/policies', async () => {
    const { fetch: fetchImpl, calls } = installFetch(() => jsonResponse(200, { apiVersion: 'vulnify.io/v1', policies: [] }));
    const { mcp, close } = await withClient(fetchImpl);
    try {
      const result = await mcp.callTool({ name: 'list_policies', arguments: {} });
      assert.notEqual(result.isError, true);
      assert.equal(calls[0]?.method, 'GET');
      assert.equal(calls[0]?.url, `${BASE}/v1/policies`);
      assert.equal(calls[0]?.body, undefined);
    } finally {
      await close();
    }
  });

  it('test_policies forwards cases and proposed policies', async () => {
    const { fetch: fetchImpl, calls } = installFetch(() => jsonResponse(200, { results: [] }));
    const { mcp, close } = await withClient(fetchImpl);
    try {
      await mcp.callTool({
        name: 'test_policies',
        arguments: {
          policies: [{ name: 'block-export', action: 'EXPORT', decision: 'BLOCK' }],
          cases: [
            {
              name: 'big export',
              input: { agent: 'SalesBot', action: 'EXPORT_DATA', resource: 'Customer Database' },
              expect: { decision: 'BLOCK', policy: 'block-export' },
            },
          ],
        },
      });
      assert.equal(calls[0]?.url, `${BASE}/v1/policies/test`);
      const body = calls[0]?.body as { policies: unknown[]; cases: unknown[] };
      assert.equal(body.policies.length, 1);
      assert.equal(body.cases.length, 1);
    } finally {
      await close();
    }
  });

  it('plan_policy_changes always sends dryRun true', async () => {
    const { fetch: fetchImpl, calls } = installFetch(() =>
      jsonResponse(200, { dryRun: true, changes: [{ name: 'block-export', op: 'create' }] }),
    );
    const { mcp, close } = await withClient(fetchImpl);
    try {
      const result = await mcp.callTool({
        name: 'plan_policy_changes',
        arguments: {
          policies: [{ name: 'block-export', action: 'EXPORT', decision: 'BLOCK' }],
          prune: false,
        },
      });
      assert.notEqual(result.isError, true);
      assert.equal(calls[0]?.url, `${BASE}/v1/policies/apply`);
      const body = calls[0]?.body as { dryRun: boolean; prune: boolean };
      assert.equal(body.dryRun, true);
      assert.equal(body.prune, false);
    } finally {
      await close();
    }
  });

  it('rejects a plan that tries to pass dryRun', async () => {
    const { fetch: fetchImpl, calls } = installFetch(() => jsonResponse(200, { dryRun: true, changes: [] }));
    const { mcp, close } = await withClient(fetchImpl);
    try {
      const result = await mcp.callTool({
        name: 'plan_policy_changes',
        arguments: {
          policies: [{ name: 'block-export', action: 'EXPORT', decision: 'BLOCK' }],
          dryRun: false,
        },
      });
      assert.equal(result.isError, true);
      assert.equal(calls.length, 0);
    } finally {
      await close();
    }
  });

  it('check_mcp_tool_call posts to the gateway and records', async () => {
    const { fetch: fetchImpl, calls } = installFetch(() => jsonResponse(200, { ...decision, decision: 'BLOCK', finalDecision: 'BLOCK' }));
    const { mcp, close } = await withClient(fetchImpl);
    try {
      const result = await mcp.callTool({
        name: 'check_mcp_tool_call',
        arguments: { tool: 'export_customers', arguments: { table: 'customers' }, agent: 'SalesBot' },
      });
      assert.notEqual(result.isError, true);
      assert.equal(calls[0]?.url, `${BASE}/v1/gateway/mcp`);
      const body = calls[0]?.body as { tool: string; arguments: { table: string } };
      assert.equal(body.tool, 'export_customers');
      assert.equal(body.arguments.table, 'customers');
      assert.equal(JSON.parse(textOf(result)).idempotentReplay, false);
    } finally {
      await close();
    }
  });

  it('maps 401, 403, 413, and 429 to tool errors without echoing the key', async () => {
    const cases: Array<{ status: number; body: unknown; pattern: RegExp }> = [
      { status: 401, body: { message: `bad ${API_KEY}` }, pattern: /\(401\)/ },
      { status: 403, body: {}, pattern: /\(403\)/ },
      { status: 413, body: {}, pattern: /\(413\)/ },
      { status: 429, body: { error: 'rate_limited' }, pattern: /\(429\)/ },
    ];
    for (const item of cases) {
      const { fetch: fetchImpl } = installFetch(() => jsonResponse(item.status, item.body));
      const { mcp, close } = await withClient(fetchImpl);
      try {
        const result = await mcp.callTool({
          name: 'decide_action',
          arguments: { agent: 'SalesBot', action: 'READ_DATA', resource: 'Customer Database' },
        });
        assert.equal(result.isError, true);
        const text = textOf(result);
        assert.match(text, item.pattern);
        assert.equal(text.includes(API_KEY), false);
        assert.equal(text.includes('vln_test_'), false);
      } finally {
        await close();
      }
    }
  });

  it('drops checkout and upgrade links from tool results and errors', async () => {
    const checkout = 'https://app.vulnify.io/billing/upgrade';
    const { fetch: fetchImpl } = installFetch(() =>
      jsonResponse(400, {
        message: `Quota exceeded. Continue at ${checkout}. See https://docs.vulnify.io/mcp/.`,
      }),
    );
    const { mcp, close } = await withClient(fetchImpl);
    try {
      const result = await mcp.callTool({
        name: 'decide_action',
        arguments: { agent: 'SalesBot', action: 'READ_DATA', resource: 'Customer Database' },
      });
      const text = textOf(result);
      assert.equal(result.isError, true);
      assert.equal(text.includes(checkout), false);
      assert.equal(text.includes('upgrade'), false);
      assert.match(text, /docs\.vulnify\.io\/mcp/);
    } finally {
      await close();
    }

    const { fetch: okFetch } = installFetch(() =>
      jsonResponse(200, {
        ...decision,
        finalDecision: 'ALLOW',
        upgradeUrl: checkout,
        note: `Allowed. Manage the plan at ${checkout}`,
      }),
    );
    const ok = await withClient(okFetch);
    try {
      const result = await ok.mcp.callTool({
        name: 'decide_action',
        arguments: { agent: 'SalesBot', action: 'READ_DATA', resource: 'Customer Database' },
      });
      const text = textOf(result);
      assert.notEqual(result.isError, true);
      assert.equal(text.includes(checkout), false);
      assert.equal(text.includes('upgradeUrl'), false);
      assert.match(text, /ALLOW/);
    } finally {
      await ok.close();
    }
  });

  it('explains a 403 from plan_policy_changes when the key is not org-wide LIVE', async () => {
    const { fetch: fetchImpl } = installFetch(() =>
      jsonResponse(403, { error: 'forbidden', message: 'policies:apply requires an org-wide LIVE key' }),
    );
    const { mcp, close } = await withClient(fetchImpl);
    try {
      const result = await mcp.callTool({
        name: 'plan_policy_changes',
        arguments: { policies: [{ name: 'block-export', action: 'EXPORT', decision: 'BLOCK' }] },
      });
      assert.match(textOf(result), /org-wide LIVE/);
    } finally {
      await close();
    }
  });
});

describe('package identity', () => {
  it('matches package.json and server.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
      mcpName: string;
      name: string;
    };
    const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8')) as {
      name: string;
      version: string;
      packages: Array<{ identifier: string; version: string }>;
    };
    assert.equal(pkg.version, VERSION);
    assert.equal(pkg.mcpName, 'io.vulnify/mcp');
    assert.equal(server.name, pkg.mcpName);
    assert.equal(server.version, pkg.version);
    assert.equal(server.packages[0]?.identifier, pkg.name);
    assert.equal(server.packages[0]?.version, pkg.version);
    assert.equal(DEFAULT_BASE_URL, 'https://api.vulnify.io');
  });
});
