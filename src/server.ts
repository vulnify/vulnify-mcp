import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  DECISIONS_URI,
  INSTRUCTIONS,
  OAUTH_INSTRUCTIONS,
  SERVER_ICONS,
  SERVER_NAME,
  SERVER_TITLE,
  VERSION,
  WEBSITE_URL,
} from './constants.js';
import { eventActionSchema, eventDestinationSchema } from './schemas.js';
import { registerTools, type ToolRuntime } from './tools.js';

const DECISIONS_TEXT = [
  'The finalDecision field is the authoritative result.',
  'ALLOW means the action may proceed.',
  'REVIEW means a person decides. This server cannot approve or deny a review.',
  'BLOCK means the action was not allowed.',
  'decision is the stored result and does not change when a review is resolved. finalDecision stays REVIEW until a person approves, denies, or the review expires.',
  'A tool error does not include finalDecision.',
].join(' ');

export function createVulnifyServer(runtime: ToolRuntime): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: VERSION,
      title: SERVER_TITLE,
      websiteUrl: WEBSITE_URL,
      icons: SERVER_ICONS.map((icon) => ({ ...icon, sizes: [...icon.sizes] })),
    },
    { instructions: runtime.client.usesApiKey() ? INSTRUCTIONS : OAUTH_INSTRUCTIONS },
  );
  registerTools(server, runtime);
  registerPrompts(server);
  registerDecisionsResource(server);
  return server;
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'guard_action',
    {
      title: 'Guard an action',
      description:
        'Ask the model to check a proposed action with Vulnify before it runs, and explain ALLOW, REVIEW, and BLOCK.',
      argsSchema: {
        agent: z.string().describe('Agent name registered in Vulnify.'),
        action: eventActionSchema.describe('Event action. Allowed values: READ_DATA, WRITE_DATA, DELETE_DATA, EXPORT_DATA, SEND_EMAIL.'),
        resource: z.string().describe('Resource name registered in Vulnify.'),
        destination: eventDestinationSchema.optional().describe('Where the data goes. Optional. Allowed values: INTERNAL, EXTERNAL_EMAIL, EXTERNAL_API.'),
        records: z.string().optional().describe('How many records the action would touch, as text. Optional.'),
      },
    },
    async (args) => {
      const lines = [`Agent: ${args.agent}`, `Action: ${args.action}`, `Resource: ${args.resource}`];
      if (args.destination) lines.push(`Destination: ${args.destination}`);
      if (args.records) lines.push(`Records: ${args.records}`);
      return {
        description: 'Check this action with Vulnify before it runs.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                'Check this action with Vulnify before it runs.',
                'Call check_action to preview the decision. check_action records nothing.',
                'Call decide_action when the action should be recorded.',
                '',
                ...lines,
                '',
                'The finalDecision field is the authoritative result.',
                'ALLOW means the action may proceed.',
                'REVIEW means a person decides. This server cannot approve or deny a review.',
                'BLOCK means the action was not allowed.',
                'A tool error does not include finalDecision.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'review_policies',
    {
      title: 'Review policies',
      description: 'Ask the model to list the organization policies and test them. Nothing is written.',
    },
    async () => ({
      description: 'List the stored policies, then test them.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'List the organization policies with list_policies.',
              'Then test them with test_policies.',
              'test_policies evaluates up to 200 cases and records nothing.',
              'When policies is set, those proposed policies are evaluated and nothing is written.',
              'pass is null when a case omits expect.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}

function registerDecisionsResource(server: McpServer): void {
  server.registerResource(
    'decisions',
    DECISIONS_URI,
    {
      title: 'Decisions',
      description: 'What ALLOW, REVIEW, and BLOCK mean. finalDecision is the authoritative result.',
      mimeType: 'text/plain',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/plain', text: DECISIONS_TEXT }],
    }),
  );
}
