import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readApiKey, readHttpCredential } from './auth.js';
import { startHttpServer } from './http.js';
import { redact } from './redact.js';
import type { ServerCard } from './server-card.js';

const KEY = 'vln_test_http_header_key';
const OTHER = 'vln_live_other_header_key';
const TOKEN = 'vln_oat_http_access_token';
const WRITER = 'vln_oat_http_writer_token';
const SECRET = 'introspection-secret-for-tests';
const CHALLENGE =
  'Bearer realm="https://mcp.vulnify.io/mcp", resource_metadata="https://mcp.vulnify.io/.well-known/oauth-protected-resource/mcp"';
const PROTECTED_RESOURCE = {
  resource: 'https://mcp.vulnify.io/mcp',
  authorization_servers: ['https://api.vulnify.io'],
  scopes_supported: [
    'decisions:read',
    'decisions:write',
    'policies:read',
    'policies:test',
    'reviews:read',
    'reviews:decide',
    'audit:read',
  ],
  bearer_methods_supported: ['header'],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('readApiKey', () => {
  it('accepts Bearer and X-Vulnify-Key, and rejects a mismatch', () => {
    assert.deepEqual(readApiKey({ authorization: `Bearer ${KEY}` }), { ok: true, apiKey: KEY });
    assert.deepEqual(readApiKey({ 'x-vulnify-key': KEY }), { ok: true, apiKey: KEY });
    assert.deepEqual(readApiKey({ authorization: `bearer ${KEY}`, 'x-vulnify-key': KEY }), { ok: true, apiKey: KEY });
    const mismatch = readApiKey({ authorization: `Bearer ${KEY}`, 'x-vulnify-key': OTHER });
    assert.equal(mismatch.ok, false);
    const missing = readApiKey({});
    assert.equal(missing.ok, false);
    const basic = readApiKey({ authorization: `Basic ${KEY}` });
    assert.equal(basic.ok, false);
  });
});

describe('readHttpCredential', () => {
  it('keeps API keys and classifies vln_oat_ as OAuth', () => {
    assert.deepEqual(readHttpCredential({ authorization: `Bearer ${KEY}` }), { ok: true, kind: 'api_key', apiKey: KEY });
    assert.deepEqual(readHttpCredential({ 'x-vulnify-key': OTHER }), { ok: true, kind: 'api_key', apiKey: OTHER });
    assert.deepEqual(readHttpCredential({ authorization: `Bearer ${TOKEN}` }), {
      ok: true,
      kind: 'oauth',
      accessToken: TOKEN,
    });
    const missing = readHttpCredential({});
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.challenge, 'missing');
  });
});

describe('redact', () => {
  it('removes live and test key material', () => {
    const token = 'vln_oat_http_access_token';
    const text = redact(`denied for ${KEY} and ${OTHER} and ${token}`);
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes(OTHER), false);
    assert.equal(text.includes(token), false);
    assert.match(text, /vln_\[redacted\]/);
  });
});

describe('HTTP server', () => {
  const servers: Server[] = [];
  const logs: string[] = [];
  let restoreStderr: (() => void) | undefined;

  afterEach(async () => {
    restoreStderr?.();
    restoreStderr = undefined;
    logs.length = 0;
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  async function listen(options: {
    fetchImpl?: typeof fetch;
    introspectionSecret?: string;
    now?: () => number;
  } = {}): Promise<string> {
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      logs.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    restoreStderr = () => {
      process.stderr.write = original;
    };
    const server = await startHttpServer({
      port: 0,
      host: '127.0.0.1',
      baseUrl: 'https://api.vulnify.test',
      fetch: options.fetchImpl,
      introspectionSecret: options.introspectionSecret,
      now: options.now,
      logger: (line) => {
        logs.push(line);
      },
    });
    servers.push(server);
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  it('serves /health and the server card without a key', async () => {
    const base = await listen();
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const body = (await health.json()) as { ok: boolean; version: string };
    assert.equal(body.ok, true);
    assert.equal(body.version, '0.1.2');
    const card = await fetch(`${base}/.well-known/mcp/server-card.json`);
    assert.equal(card.status, 200);
    const cardBody = (await card.json()) as {
      transport: { url: string };
      authentication: { required: boolean; schemes: string[]; resourceMetadata: string };
    };
    assert.equal(cardBody.transport.url, 'https://mcp.vulnify.io/mcp');
    assert.equal(cardBody.authentication.required, true);
    assert.deepEqual(cardBody.authentication.schemes, ['oauth2', 'bearer', 'x-vulnify-key']);
    assert.equal(cardBody.authentication.resourceMetadata, 'https://mcp.vulnify.io/.well-known/oauth-protected-resource/mcp');
  });

  it('serves the protected resource metadata without credentials', async () => {
    let called = false;
    const base = await listen({
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      assert.deepEqual(await response.json(), PROTECTED_RESOURCE);
    }
    assert.equal(called, false);
  });

  it('publishes the registered tools, header auth, and links on the server card', async () => {
    const base = await listen();
    const card = await fetch(`${base}/.well-known/mcp/server-card.json`);
    assert.equal(card.status, 200);
    const cardBody = (await card.json()) as ServerCard;

    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
    });
    const client = new Client({ name: 'card-test', version: '0.0.0' });
    await client.connect(transport);
    const listed = await client.listTools();
    await client.close();
    await transport.close();

    assert.equal(listed.tools.length, 7);
    assert.deepEqual(
      cardBody.tools,
      listed.tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    );
    for (const tool of cardBody.tools) {
      assert.equal(typeof tool.description, 'string');
      assert.equal(tool.inputSchema.type, 'object');
    }

    assert.equal(cardBody.authentication.required, true);
    assert.deepEqual(cardBody.authentication.schemes, ['oauth2', 'bearer', 'x-vulnify-key']);
    assert.equal(cardBody.authentication.resourceMetadata, 'https://mcp.vulnify.io/.well-known/oauth-protected-resource/mcp');
    assert.match(cardBody.authentication.description, /OAuth/);
    assert.match(cardBody.authentication.description, /Vulnify API key/);
    assert.match(cardBody.authentication.description, /Authorization header/);
    assert.match(cardBody.authentication.description, /X-Vulnify-Key/);
    assert.equal(cardBody.links.documentation, 'https://docs.vulnify.io/mcp/');
    assert.equal(cardBody.links.repository, 'https://github.com/vulnify/vulnify-mcp');
    assert.equal(cardBody.websiteUrl, 'https://docs.vulnify.io/mcp/');
    assert.equal(cardBody.repository.url, 'https://github.com/vulnify/vulnify-mcp');
  });

  it('returns 401 for an unauthenticated MCP request', async () => {
    let called = false;
    const base = await listen({
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), CHALLENGE);
    const payload = (await response.json()) as { message: string };
    assert.match(payload.message, /Sign in with Vulnify/);
    assert.match(payload.message, /Authorization/);
    assert.equal(payload.message.includes(KEY), false);
    assert.equal(called, false);
    const get = await fetch(`${base}/mcp`);
    assert.equal(get.status, 401);
    assert.equal(get.headers.get('www-authenticate'), CHALLENGE);
    const del = await fetch(`${base}/mcp`, { method: 'DELETE' });
    assert.equal(del.status, 401);
    assert.equal(del.headers.get('www-authenticate'), CHALLENGE);
  });

  it('accepts Authorization Bearer and X-Vulnify-Key, and rejects a mismatch', async () => {
    const seen: string[] = [];
    const urls: string[] = [];
    const base = await listen({
      introspectionSecret: SECRET,
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        urls.push(url);
        seen.push(new Headers(init?.headers).get('authorization') ?? '');
        return jsonResponse({ apiVersion: 'vulnify.io/v1', policies: [] });
      },
    });

    async function connect(headers: Record<string, string>) {
      const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } });
      const client = new Client({ name: 'http-test', version: '0.0.0' });
      await client.connect(transport);
      const result = await client.callTool({ name: 'list_policies', arguments: {} });
      await client.close();
      await transport.close();
      return result;
    }

    const bearer = await connect({ Authorization: `Bearer ${KEY}` });
    assert.notEqual(bearer.isError, true);
    assert.equal(seen.at(-1), `Bearer ${KEY}`);

    const header = await connect({ 'X-Vulnify-Key': KEY });
    assert.notEqual(header.isError, true);
    assert.equal(seen.at(-1), `Bearer ${KEY}`);
    assert.equal(urls.some((url) => url.includes('/oauth/introspect')), false);
    assert.equal(urls.some((url) => url.includes('/v1/mcp/')), false);
    assert.ok(urls.includes('https://api.vulnify.test/v1/policies'));

    const mismatch = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${KEY}`,
        'x-vulnify-key': OTHER,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    assert.equal(mismatch.status, 401);
    const mismatchBody = await mismatch.text();
    assert.equal(mismatchBody.includes(KEY), false);
    assert.equal(mismatchBody.includes(OTHER), false);

    const logText = logs.join('\n');
    assert.equal(logText.includes(KEY), false);
    assert.equal(logText.includes(OTHER), false);
    assert.equal(logText.includes(SECRET), false);
  });

  it('rejects an inactive OAuth token and does not cache that result', async () => {
    let introspects = 0;
    let apiCalls = 0;
    const base = await listen({
      introspectionSecret: SECRET,
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith('/oauth/introspect')) {
          introspects += 1;
          const headers = new Headers(init?.headers);
          assert.equal(headers.get('authorization'), `Bearer ${SECRET}`);
          assert.match(headers.get('content-type') ?? '', /application\/x-www-form-urlencoded/);
          assert.equal(String(init?.body), `token=${TOKEN}`);
          return jsonResponse({ active: false });
        }
        apiCalls += 1;
        return jsonResponse({});
      },
    });

    for (let i = 0; i < 2; i += 1) {
      const response = await postInitialize(base, TOKEN);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('www-authenticate'), `${CHALLENGE}, error="invalid_token"`);
      const body = await response.text();
      assert.equal(body.includes(TOKEN), false);
      assert.equal(body.includes(SECRET), false);
    }
    assert.equal(introspects, 2);
    assert.equal(apiCalls, 0);
    const logText = logs.join('\n');
    assert.equal(logText.includes(TOKEN), false);
    assert.equal(logText.includes(SECRET), false);
  });

  it('caches an active introspection for at most 60s and never past exp', async () => {
    let now = 1_700_000_000_000;
    let introspects = 0;
    const base = await listen({
      introspectionSecret: SECRET,
      now: () => now,
      fetchImpl: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith('/oauth/introspect')) {
          introspects += 1;
          return jsonResponse({
            active: true,
            scope: 'policies:read',
            exp: Math.floor(now / 1000) + 30,
            aud: 'https://mcp.vulnify.io/mcp',
          });
        }
        return jsonResponse({ apiVersion: 'vulnify.io/v1', policies: [] });
      },
    });

    assert.equal((await postInitialize(base, TOKEN)).status, 200);
    now += 29_000;
    assert.equal((await postInitialize(base, TOKEN)).status, 200);
    assert.equal(introspects, 1);
    now += 2_000;
    assert.equal((await postInitialize(base, TOKEN)).status, 200);
    assert.equal(introspects, 2);

    now = 1_800_000_000_000;
    const farExp = Math.floor(now / 1000) + 3_600;
    const later = await listen({
      introspectionSecret: SECRET,
      now: () => now,
      fetchImpl: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith('/oauth/introspect')) {
          introspects += 1;
          return jsonResponse({ active: true, scope: 'policies:read', exp: farExp, aud: 'https://mcp.vulnify.io/mcp' });
        }
        return jsonResponse({ apiVersion: 'vulnify.io/v1', policies: [] });
      },
    });
    const before = introspects;
    assert.equal((await postInitialize(later, TOKEN)).status, 200);
    now += 60_000;
    assert.equal((await postInitialize(later, TOKEN)).status, 200);
    assert.equal(introspects, before + 2);
  });

  it('calls /v1/mcp with the user token and denies a missing scope', async () => {
    const calls: { url: string; authorization: string }[] = [];
    const base = await listen({
      introspectionSecret: SECRET,
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const authorization = new Headers(init?.headers).get('authorization') ?? '';
        if (url.endsWith('/oauth/introspect')) {
          const body = String(init?.body);
          assert.match(body, /^token=vln_oat_/);
          assert.equal(authorization, `Bearer ${SECRET}`);
          const writer = body.includes(WRITER);
          return jsonResponse({
            active: true,
            scope: writer ? 'decisions:read decisions:write policies:read policies:test' : 'decisions:read policies:test',
            exp: Math.floor(Date.now() / 1000) + 120,
            aud: 'https://mcp.vulnify.io/mcp',
          });
        }
        calls.push({ url, authorization });
        if (url.endsWith('/v1/mcp/events/evt_1')) return jsonResponse({ id: 'evt_1', finalDecision: 'ALLOW' });
        return jsonResponse({ apiVersion: 'vulnify.io/v1', policies: [] });
      },
    });

    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: 'oauth-test', version: '0.0.0' });
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.includes('approve_review'), false);
    assert.equal(names.includes('deny_review'), false);

    const listed = await client.callTool({ name: 'list_policies', arguments: {} });
    assert.equal(listed.isError, true);
    assert.match(textOf(listed), /policies:read/);
    assert.equal(textOf(listed).includes(TOKEN), false);

    const checked = await client.callTool({
      name: 'check_action',
      arguments: { agent: 'SupportBot', action: 'READ_DATA', resource: 'Customer Database' },
    });
    assert.notEqual(checked.isError, true);

    const tested = await client.callTool({
      name: 'test_policies',
      arguments: {
        cases: [{ name: 'read', input: { agent: 'SupportBot', action: 'READ_DATA', resource: 'Customer Database' } }],
      },
    });
    assert.notEqual(tested.isError, true);

    const decided = await client.callTool({
      name: 'decide_action',
      arguments: { agent: 'SupportBot', action: 'READ_DATA', resource: 'Customer Database' },
    });
    assert.equal(decided.isError, true);
    assert.match(textOf(decided), /decisions:write/);

    const got = await client.callTool({ name: 'get_decision', arguments: { id: 'evt_1' } });
    assert.notEqual(got.isError, true);

    const planned = await client.callTool({ name: 'plan_policy_changes', arguments: { policies: [] } });
    assert.equal(planned.isError, true);
    assert.match(textOf(planned), /API key/);
    assert.match(textOf(planned), /policy apply/);

    const gateway = await client.callTool({ name: 'check_mcp_tool_call', arguments: { tool: 'export_customers' } });
    assert.equal(gateway.isError, true);
    assert.match(textOf(gateway), /API key/);
    assert.match(textOf(gateway), /MCP gateway/);

    await client.close();
    await transport.close();

    const writerTransport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${WRITER}` } },
    });
    const writer = new Client({ name: 'oauth-writer', version: '0.0.0' });
    await writer.connect(writerTransport);
    const recorded = await writer.callTool({
      name: 'decide_action',
      arguments: { agent: 'SupportBot', action: 'READ_DATA', resource: 'Customer Database' },
    });
    assert.notEqual(recorded.isError, true);
    const policies = await writer.callTool({ name: 'list_policies', arguments: {} });
    assert.notEqual(policies.isError, true);
    await writer.close();
    await writerTransport.close();

    assert.deepEqual(
      calls.map((call) => call.url),
      [
        'https://api.vulnify.test/v1/mcp/policies/test',
        'https://api.vulnify.test/v1/mcp/policies/test',
        'https://api.vulnify.test/v1/mcp/events/evt_1',
        'https://api.vulnify.test/v1/mcp/events',
        'https://api.vulnify.test/v1/mcp/policies',
      ],
    );
    assert.deepEqual(
      calls.map((call) => call.authorization),
      [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`, `Bearer ${TOKEN}`, `Bearer ${WRITER}`, `Bearer ${WRITER}`],
    );
    assert.equal(logs.join('\n').includes(TOKEN), false);
    assert.equal(logs.join('\n').includes(WRITER), false);
    assert.equal(logs.join('\n').includes(SECRET), false);
  });

  it('returns 503 when the introspection secret is not configured', async () => {
    let called = false;
    const base = await listen({
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    const oauth = await postInitialize(base, TOKEN);
    assert.equal(oauth.status, 503);
    const body = await oauth.text();
    assert.equal(body.includes(TOKEN), false);
    const key = await postInitialize(base, KEY);
    assert.equal(key.status, 200);
    assert.equal(called, false);
    assert.equal(logs.join('\n').includes(TOKEN), false);
  });
});

describe('smithery.yaml', () => {
  it('points Smithery at the hosted HTTP server and the API-key header', () => {
    const yaml = readFileSync(new URL('../smithery.yaml', import.meta.url), 'utf8');
    assert.match(yaml, /type:\s*http/);
    assert.match(yaml, /url:\s*https:\/\/mcp\.vulnify\.io\/mcp/);
    assert.match(yaml, /header:\s*X-Vulnify-Key/);
    assert.match(yaml, /https:\/\/docs\.vulnify\.io\/mcp\//);
    assert.match(yaml, /https:\/\/github\.com\/vulnify\/vulnify-mcp/);
  });
});

function textOf(result: unknown): string {
  return JSON.stringify(result);
}

function postInitialize(base: string, token: string): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    }),
  });
}
