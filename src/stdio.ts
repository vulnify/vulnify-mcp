import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VulnifyClient } from './api.js';
import { createVulnifyServer } from './server.js';

export async function runStdio(options: { apiKey: string; baseUrl: string }): Promise<void> {
  const client = new VulnifyClient({ apiKey: options.apiKey, baseUrl: options.baseUrl });
  const server = createVulnifyServer({ client });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
