import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { INSTRUCTIONS, SERVER_NAME, SERVER_TITLE, VERSION } from './constants.js';
import { registerTools, type ToolRuntime } from './tools.js';

export function createVulnifyServer(runtime: ToolRuntime): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION, title: SERVER_TITLE },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, runtime);
  return server;
}
