import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { VulnifyClient } from './api.js';
import { DEFAULT_BASE_URL, SERVER_NAME, SERVER_TITLE, VERSION } from './constants.js';
import { createVulnifyServer } from './server.js';

export const DOCS_URL = 'https://docs.vulnify.io/mcp/';
export const REPOSITORY_URL = 'https://github.com/vulnify/vulnify-mcp';
export const MCP_URL = 'https://mcp.vulnify.io/mcp';

const API_KEY_HEADER =
  'A Vulnify API key is required on every MCP request. Send it in the Authorization header as "Bearer <key>", or in the X-Vulnify-Key header.';

export interface ServerCardTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Tool['inputSchema'];
}

export interface ServerCard {
  serverInfo: {
    name: string;
    title: string;
    version: string;
  };
  description: string;
  websiteUrl: string;
  repository: {
    url: string;
    source: 'github';
  };
  links: {
    documentation: string;
    repository: string;
  };
  transport: {
    type: 'streamable-http';
    url: string;
  };
  authentication: {
    required: true;
    schemes: ['bearer', 'x-vulnify-key'];
    description: string;
  };
  tools: ServerCardTool[];
  resources: [];
  prompts: [];
}

/**
 * Names, descriptions, and input schemas from tools/list on a server built
 * with the same registerTools path the HTTP and stdio servers use.
 */
async function listedTools(): Promise<Tool[]> {
  const api = new VulnifyClient({
    apiKey: 'vln_test_server_card',
    baseUrl: DEFAULT_BASE_URL,
    fetch: async () => {
      throw new Error('The server card does not call the Vulnify API.');
    },
  });
  const mcpServer = createVulnifyServer({ client: api });
  const client = new Client({ name: 'vulnify-server-card', version: VERSION });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    return listed.tools;
  } finally {
    await client.close();
    await mcpServer.close();
  }
}

function cardTool(tool: Pick<Tool, 'name' | 'title' | 'description' | 'inputSchema'>): ServerCardTool {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
  };
}

export async function buildServerCard(): Promise<ServerCard> {
  const tools = (await listedTools()).map(cardTool);
  return {
    serverInfo: {
      name: SERVER_NAME,
      title: SERVER_TITLE,
      version: VERSION,
    },
    description: 'Ask Vulnify before an AI agent acts. Check, record, and read policy decisions.',
    websiteUrl: DOCS_URL,
    repository: {
      url: REPOSITORY_URL,
      source: 'github',
    },
    links: {
      documentation: DOCS_URL,
      repository: REPOSITORY_URL,
    },
    transport: {
      type: 'streamable-http',
      url: MCP_URL,
    },
    authentication: {
      required: true,
      schemes: ['bearer', 'x-vulnify-key'],
      description: API_KEY_HEADER,
    },
    tools,
    resources: [],
    prompts: [],
  };
}

let pending: Promise<ServerCard> | undefined;

export function serverCard(): Promise<ServerCard> {
  pending ??= buildServerCard().catch((err: unknown) => {
    pending = undefined;
    throw err;
  });
  return pending;
}
