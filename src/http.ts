import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type ErrorRequestHandler, type Express, type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'node:http';
import { ApiKeyChecker } from './api-key.js';
import { VulnifyClient } from './api.js';
import { readHttpCredential } from './auth.js';
import { DEFAULT_PORT, PROTECTED_RESOURCE_METADATA, VERSION } from './constants.js';
import { TokenIntrospector, wwwAuthenticate } from './oauth.js';
import { redact } from './redact.js';
import { createVulnifyServer } from './server.js';
import { serverCard } from './server-card.js';

export type Logger = (line: string) => void;

export interface HttpAppOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  logger?: Logger;
  /** Bearer secret for POST /oauth/introspect. Required for `vln_oat_...` tokens. API keys work without it. */
  introspectionSecret?: string;
  /** Clock for the introspection cache. Tests inject this. */
  now?: () => number;
}

export interface ListenOptions extends HttpAppOptions {
  port?: number;
  host?: string;
}

function defaultLogger(line: string): void {
  process.stderr.write(`${redact(line)}\n`);
}

function unauthorized(res: Response, message: string, error?: 'invalid_token' | 'invalid_request'): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('WWW-Authenticate', wwwAuthenticate(error));
  res.status(401).json({ error: 'unauthorized', message });
}

function sendProtectedResource(res: Response): void {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json(PROTECTED_RESOURCE_METADATA);
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
  const introspector = new TokenIntrospector({
    baseUrl: options.baseUrl,
    secret: options.introspectionSecret,
    fetch: options.fetch,
    now: options.now,
  });
  const apiKeys = new ApiKeyChecker({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    now: options.now,
  });
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

  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    sendProtectedResource(res);
  });
  app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
    sendProtectedResource(res);
  });

  app.use(express.json({ limit: '256kb' }));
  app.use(jsonTooLarge);

  app.all('/mcp', async (req: Request, res: Response) => {
    res.on('finish', () => {
      logger(`${req.method} ${req.path} ${res.statusCode}`);
    });

    const credential = readHttpCredential(req.headers);
    if (!credential.ok) {
      const error = credential.challenge === 'missing' ? undefined : credential.challenge;
      unauthorized(res, credential.message, error);
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

    let client: VulnifyClient;
    if (credential.kind === 'oauth') {
      const introspection = await introspector.introspect(credential.accessToken);
      if (!introspection.ok) {
        if (introspection.reason === 'inactive') {
          unauthorized(res, 'The access token is invalid, revoked, or expired.', 'invalid_token');
          return;
        }
        logger(
          introspection.reason === 'unconfigured' ? 'oauth introspection is not configured' : 'oauth introspection unavailable',
        );
        res.setHeader('Cache-Control', 'no-store');
        res.status(503).json({
          error: 'unavailable',
          message: 'Vulnify could not validate the access token. Try again shortly.',
        });
        return;
      }
      client = new VulnifyClient({
        baseUrl: options.baseUrl,
        fetch: options.fetch,
        oauth: { accessToken: credential.accessToken, scopes: introspection.scopes },
      });
    } else {
      const check = await apiKeys.check(credential.apiKey);
      if (!check.ok) {
        if (check.reason === 'invalid') {
          unauthorized(res, 'Vulnify rejected the API key. It is invalid, revoked, or expired.', 'invalid_token');
          return;
        }
        logger('api key validation unavailable');
        res.setHeader('Cache-Control', 'no-store');
        res.status(503).json({
          error: 'unavailable',
          message: 'Vulnify could not validate the API key. Try again shortly.',
        });
        return;
      }
      client = new VulnifyClient({
        apiKey: credential.apiKey,
        baseUrl: options.baseUrl,
        fetch: options.fetch,
      });
    }
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
