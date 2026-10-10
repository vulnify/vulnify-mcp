import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readApiKey } from './auth.js';
import { startHttpServer } from './http.js';
import { redact } from './redact.js';

const KEY = 'vln_test_http_header_key';
const OTHER = 'vln_live_other_header_key';

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

describe('redact', () => {
  it('removes live and test key material', () => {
    const text = redact(`denied for ${KEY} and ${OTHER}`);
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes(OTHER), false);
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

  async function listen(fetchImpl?: typeof fetch): Promise<string> {
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
      fetch: fetchImpl,
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
    assert.equal(body.version, '0.1.1');
    const card = await fetch(`${base}/.well-known/mcp/server-card.json`);
    assert.equal(card.status, 200);
    const cardBody = (await card.json()) as { transport: { url: string } };
    assert.equal(cardBody.transport.url, 'https://mcp.vulnify.io/mcp');
  });

  it('returns 401 for an unauthenticated MCP request', async () => {
    let called = false;
    const base = await listen(async () => {
      called = true;
      return jsonResponse({});
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
    assert.match(response.headers.get('www-authenticate') ?? '', /Bearer/);
    const payload = (await response.json()) as { message: string };
    assert.match(payload.message, /Authorization/);
    assert.equal(payload.message.includes(KEY), false);
    assert.equal(called, false);
    const get = await fetch(`${base}/mcp`);
    assert.equal(get.status, 401);
    const del = await fetch(`${base}/mcp`, { method: 'DELETE' });
    assert.equal(del.status, 401);
  });

  it('accepts Authorization Bearer and X-Vulnify-Key, and rejects a mismatch', async () => {
    const seen: string[] = [];
    const base = await listen(async (_input, init) => {
      seen.push(new Headers(init?.headers).get('authorization') ?? '');
      return jsonResponse({ apiVersion: 'vulnify.io/v1', policies: [] });
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
  });
});
