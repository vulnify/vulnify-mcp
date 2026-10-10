/**
 * Opt-in smoke test against https://api.vulnify.io.
 * Skips with exit 0 when VULNIFY_TEST_API_KEY is unset. Never prints the key.
 * Calls list_policies only, which does not record an event.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { VulnifyClient } from '../src/api.js';
import { createVulnifyServer } from '../src/server.js';

const key = process.env.VULNIFY_TEST_API_KEY;
if (!key) {
  process.stdout.write('skip: VULNIFY_TEST_API_KEY is not set\n');
  process.exit(0);
}

const api = new VulnifyClient({ apiKey: key, baseUrl: 'https://api.vulnify.io', timeoutMs: 20_000 });
const server = createVulnifyServer({ client: api });
const mcp = new Client({ name: 'vulnify-live', version: '0.1.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  const result = await mcp.callTool({ name: 'list_policies', arguments: {} });
  if (result.isError) {
    const text = JSON.stringify(result.content);
    process.stderr.write(`live list_policies failed: ${text.includes(key) ? '[redacted]' : text}\n`);
    process.exit(1);
  }
  const block = (result.content as Array<{ type: string; text?: string }>).find((item) => item.type === 'text');
  const body = JSON.parse(block?.text ?? '{}') as { apiVersion?: string; policies?: unknown };
  if (body.apiVersion !== 'vulnify.io/v1' || !Array.isArray(body.policies)) {
    process.stderr.write('live list_policies returned an unexpected body\n');
    process.exit(1);
  }
  process.stdout.write(`live ok: ${body.policies.length} policies\n`);
} finally {
  await mcp.close();
  await server.close();
}
