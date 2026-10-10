import { DEFAULT_PORT } from './constants.js';
import { resolveBaseUrl } from './config.js';
import { startHttpServer } from './http.js';
import { redact } from './redact.js';
import { runStdio } from './stdio.js';

const USAGE = `vulnify-mcp

stdio (default):  npx -y @vulnify/mcp
  Requires VULNIFY_API_KEY. Optional VULNIFY_BASE_URL (default https://api.vulnify.io).

HTTP:             vulnify-mcp --http
  Listens on PORT (default ${DEFAULT_PORT}) and HOST (default 0.0.0.0).
  Clients send Authorization: Bearer <key> or X-Vulnify-Key: <key> on each request.
  GET /health does not require a key.
`;

function fail(message: string): never {
  process.stderr.write(`${redact(message)}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(USAGE);
    return;
  }

  let baseUrl: string;
  try {
    baseUrl = resolveBaseUrl(process.env.VULNIFY_BASE_URL);
  } catch (err) {
    fail(err instanceof Error ? err.message : 'Invalid VULNIFY_BASE_URL.');
  }

  if (process.argv.includes('--http')) {
    const rawPort = process.env.PORT;
    const port = rawPort === undefined || rawPort === '' ? DEFAULT_PORT : Number(rawPort);
    if (!Number.isInteger(port) || port < 0 || port > 65535) fail('PORT must be an integer from 0 to 65535.');
    const host = process.env.HOST?.trim() || '0.0.0.0';
    if (/[\s/]/.test(host)) fail('HOST is not a valid bind address.');
    await startHttpServer({ port, host, baseUrl });
    process.stderr.write(`vulnify-mcp listening on ${host}:${port}\n`);
    return;
  }

  const apiKey = process.env.VULNIFY_API_KEY;
  if (!apiKey) {
    fail('VULNIFY_API_KEY is required. Set it in the MCP client environment. The key is not logged.');
  }
  await runStdio({ apiKey, baseUrl });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'vulnify-mcp failed to start.';
  process.stderr.write(`${redact(message)}\n`);
  process.exit(1);
});
