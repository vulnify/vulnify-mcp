import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type ErrorRequestHandler, type Express, type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'node:http';
import { readApiKey } from './auth.js';
import { VulnifyClient } from './api.js';
import { DEFAULT_PORT, VERSION } from './constants.js';
import { redact } from './redact.js';
import { createVulnifyServer } from './server.js';
import { serverCard } from './server-card.js';

export type Logger = (line: string) => void;

export interface HttpAppOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  logger?: Logger;
}

export interface ListenOptions extends HttpAppOptions {
  port?: number;
  host?: string;
}

const UNAUTHORIZED_HEADER = 'Bearer realm="vulnify"';

function defaultLogger(line: string): void {
  process.stderr.write(`${redact(line)}\n`);
}

function unauthorized(res: Response, message: string): void {
  res.setHeader('WWW-Authenticate', UNAUTHORIZED_HEADER);
  res.status(401).json({ error: 'unauthorized', message });
}

const jsonTooLarge: ErrorRequestHandler = (err: { type?: string; status?: number }, _req, res, next: NextFunction) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    res.status(413).json({
      error: 'payload_too_large',
      message: 'JSON body is larger than 256 KB. Vulnify itself rejects bodies over 200 KB.',
    });
    return;
  }
  next(err);
};

/**
 * Stateless Streamable HTTP app. A new MCP server is created per request.
 * Nothing is stored between requests, so any replica can serve any call.
 */
export function createHttpApp(options: HttpAppOptions): Express {
  const logger = options.logger ?? defaultLogger;
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, Accept, X-Vulnify-Key, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
    );
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, service: 'vulnify-mcp', version: VERSION });
  });

  app.get('/.well-known/mcp/server-card.json', async (_req, res) => {
    try {
      res.status(200).json(await serverCard());
    } catch (err) {
      logger(`server card: ${redact(err instanceof Error ? err.name : 'error')}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal_error', message: 'The server card could not be built.' });
      }
    }
  });

  app.use(express.json({ limit: '256kb' }));
  app.use(jsonTooLarge);

  app.all('/mcp', async (req: Request, res: Response) => {
    res.on('finish', () => {
      logger(`${req.method} ${req.path} ${res.statusCode}`);
    });

    const key = readApiKey(req.headers);
    if (!key.ok) {
      unauthorized(res, key.message);
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'This server is stateless. Send MCP messages with POST /mcp.' },
        id: null,
      });
      return;
    }

    const client = new VulnifyClient({
      apiKey: key.apiKey,
      baseUrl: options.baseUrl,
      fetch: options.fetch,
    });
    const mcp = createVulnifyServer({ client });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });

    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger(`mcp error: ${redact(err instanceof Error ? err.name : 'error')}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal_error', message: 'The MCP request failed.' });
      }
    }
  });

  return app;
}

export function startHttpServer(options: ListenOptions): Promise<Server> {
  const app = createHttpApp(options);
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? '0.0.0.0';
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once('error', reject);
  });
}
