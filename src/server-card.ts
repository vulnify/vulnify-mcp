import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { VulnifyClient } from './api.js';
import { DEFAULT_BASE_URL, PROTECTED_RESOURCE_METADATA_URL, SERVER_TITLE, VERSION } from './constants.js';
import { createVulnifyServer } from './server.js';

export const DOCS_URL = 'https://docs.vulnify.io/mcp/';
export const REPOSITORY_URL = 'https://github.com/vulnify/vulnify-mcp';
export const MCP_URL = 'https://mcp.vulnify.io/mcp';

const AUTH_DESCRIPTION =
  'Sign in with OAuth 2.1, or send a Vulnify API key in the Authorization header as "Bearer <key>", or in the X-Vulnify-Key header.';

export interface ServerCardIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: 'light' | 'dark';
}

export interface ServerCardTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Tool['inputSchema'];
  outputSchema?: Tool['outputSchema'];
  annotations?: Tool['annotations'];
}

export interface ServerCardPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface ServerCardResource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface ServerCard {
  serverInfo: {
    name: string;
    title: string;
    version: string;
    websiteUrl: string;
    icons: ServerCardIcon[];
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
    schemes: ['oauth2', 'bearer', 'x-vulnify-key'];
    resourceMetadata: string;
    description: string;
  };
  tools: ServerCardTool[];
  resources: ServerCardResource[];
  prompts: ServerCardPrompt[];
}

interface ListedCatalog {
  tools: Tool[];
  prompts: ServerCardPrompt[];
  resources: ServerCardResource[];
  serverInfo: ServerCard['serverInfo'];
}

/**
 * OAuth tool set, prompts, and resources from the same register path the HTTP and stdio servers use.
 * The card does not call the Vulnify API.
 */
async function listedCatalog(): Promise<ListedCatalog> {
  const api = new VulnifyClient({
    baseUrl: DEFAULT_BASE_URL,
    oauth: { accessToken: 'vln_oat_server_card', scopes: [] },
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
    const [listedTools, listedPrompts, listedResources] = await Promise.all([
      client.listTools(),
      client.listPrompts(),
      client.listResources(),
    ]);
    const info = client.getServerVersion();
    if (!info?.websiteUrl || !info.icons?.length) {
      throw new Error('MCP serverInfo is missing websiteUrl or icons.');
    }
    return {
      tools: listedTools.tools,
      prompts: listedPrompts.prompts.map((prompt) => ({
        name: prompt.name,
        ...(prompt.title ? { title: prompt.title } : {}),
        ...(prompt.description ? { description: prompt.description } : {}),
        ...(prompt.arguments ? { arguments: prompt.arguments } : {}),
      })),
      resources: listedResources.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        ...(resource.title ? { title: resource.title } : {}),
        ...(resource.description ? { description: resource.description } : {}),
        ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
      })),
      serverInfo: {
        name: info.name,
        title: info.title ?? SERVER_TITLE,
        version: info.version,
        websiteUrl: info.websiteUrl,
        icons: info.icons.map((icon) => ({
          src: icon.src,
          ...(icon.mimeType ? { mimeType: icon.mimeType } : {}),
          ...(icon.sizes ? { sizes: icon.sizes } : {}),
          ...(icon.theme ? { theme: icon.theme } : {}),
        })),
      },
    };
  } finally {
    await client.close();
    await mcpServer.close();
  }
}

function cardTool(tool: Tool): ServerCardTool {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  };
}

export async function buildServerCard(): Promise<ServerCard> {
  const catalog = await listedCatalog();
  return {
    serverInfo: catalog.serverInfo,
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
      schemes: ['oauth2', 'bearer', 'x-vulnify-key'],
      resourceMetadata: PROTECTED_RESOURCE_METADATA_URL,
      description: AUTH_DESCRIPTION,
    },
    tools: catalog.tools.map(cardTool),
    resources: catalog.resources,
    prompts: catalog.prompts,
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
