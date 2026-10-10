# Use Vulnify with Cursor, Claude, Grok or your code

The Vulnify MCP server lets an agent ask whether an action may run. The install that works today is local stdio: `npx -y @vulnify/mcp` with `VULNIFY_API_KEY`.

`check_action` previews a decision. It skips the PII scan and records nothing. `decide_action` records a decision. A `REVIEW` is not approval. This server cannot approve or deny a review.

Create a dedicated TEST key (`vln_test_...`) to try a client. Set `VULNIFY_BASE_URL` only when the API is not `https://api.vulnify.io`.

One-click Grok connectors and the Claude connectors directory are not available for this server. They authenticate with OAuth only. OAuth is planned for v1.1. The client sections below are only the clients where an API-key MCP server works today.

The hosted URL `https://mcp.vulnify.io/mcp` is not live yet. Every snippet that uses it is in [Remote URL (not live yet)](#remote-url-not-live-yet), so this page can be split there.

## Cursor

Project config is `.cursor/mcp.json`. User config is `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "vulnify": {
      "command": "npx",
      "args": ["-y", "@vulnify/mcp"],
      "env": {
        "VULNIFY_API_KEY": "${env:VULNIFY_API_KEY}"
      }
    }
  }
}
```

## Claude Code

```bash
claude mcp add --transport stdio vulnify --env VULNIFY_API_KEY=vln_test_your_key -- npx -y @vulnify/mcp
```

Prefer an environment variable over a key written into the shell history when you can. This is Claude Code on your machine. It is not the Claude connectors directory.

## Claude Desktop

Claude Desktop runs a local stdio server. Edit `claude_desktop_config.json` (on macOS, `~/Library/Application Support/Claude/claude_desktop_config.json`; on Windows, `%APPDATA%\Claude\claude_desktop_config.json`) and restart the app.

```json
{
  "mcpServers": {
    "vulnify": {
      "command": "npx",
      "args": ["-y", "@vulnify/mcp"],
      "env": {
        "VULNIFY_API_KEY": "vln_test_your_key"
      }
    }
  }
}
```

The Claude connectors directory (one-click install inside claude.ai) requires OAuth. This server does not implement OAuth yet, so there is no directory listing and no one-click Claude connector. That is planned for v1.1.

## VS Code

Workspace file `.vscode/mcp.json`, or the user MCP config.

```json
{
  "servers": {
    "vulnify": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@vulnify/mcp"],
      "env": {
        "VULNIFY_API_KEY": "${env:VULNIFY_API_KEY}"
      }
    }
  }
}
```

## Other local clients

Any MCP client that can launch a stdio process can run the same package:

```bash
VULNIFY_API_KEY=vln_test_your_key npx -y @vulnify/mcp
```

## Your code

Application code that should decide before it exports or sends data uses the SDK, not this MCP server. The MCP server is for an agent that already speaks MCP. The SDK is for your process.

```bash
npm install @vulnify/sdk
```

```ts
import { Vulnify } from '@vulnify/sdk';

const apiKey = process.env.VULNIFY_API_KEY;
if (!apiKey) throw new Error('Set VULNIFY_API_KEY');

const vulnify = new Vulnify({
  apiKey,
  baseUrl: process.env.VULNIFY_BASE_URL,
});

const decision = await vulnify.check({
  agent: 'SalesBot',
  action: 'EXPORT_DATA',
  resource: 'Customer Database',
  destination: 'EXTERNAL_EMAIL',
  recordsAffected: 12000,
});

if (decision.finalDecision !== 'ALLOW') {
  throw new Error(`Export not run (${decision.finalDecision}).`);
}
```

Obey `finalDecision`. `REVIEW` and `BLOCK` mean the export does not run. The SDK records that call (`POST /v1/events`), the same as `decide_action`. For a dry run that records nothing, use this MCP server's `check_action` or the CLI `vulnify test`. Full SDK documentation is at https://docs.vulnify.io.

If the SDK cannot reach Vulnify, the default is a fail-closed decision, not a thrown tool error. The MCP server returns an error instead, so an agent does not read a fallback as `ALLOW`.

## Security

API-key IP allowlists are checked against the hosted server's egress IP when using `https://mcp.vulnify.io/mcp`, not the end user's IP. Users who need an IP allowlist should run the local npx/stdio mode (`npx -y @vulnify/mcp`) instead.

Do not put the API key in a tool argument, a URL, or a committed config file. The local process reads `VULNIFY_API_KEY` from the environment. The hosted server, once it is deployed, reads `Authorization: Bearer <key>` or `X-Vulnify-Key` on each request and does not log the key.

## Not in this version

Grok Bot custom connectors, and the Claude connectors directory, authenticate with OAuth. There is no supported place to paste an API key, and this server does not pretend otherwise. There is no one-click Grok connector and no one-click Claude connector.

OAuth on the MCP host is planned for v1.1. Until then, use Cursor, Claude Code, Claude Desktop via `npx`, VS Code, another local stdio client, or `@vulnify/sdk`.

## Remote URL (not live yet)

Everything from this heading down uses `https://mcp.vulnify.io/mcp`. That host is not deployed yet. Keep this section together so the page can be published without it.

API-key IP allowlists are checked against the hosted server's egress IP when using `https://mcp.vulnify.io/mcp`, not the end user's IP. Users who need an IP allowlist should run the local npx/stdio mode (`npx -y @vulnify/mcp`) instead.

The server does not keep a session. Send the key on every request. A request without a key gets 401 and `WWW-Authenticate: Bearer`. `GET /health` does not require a key.

### Cursor

```json
{
  "mcpServers": {
    "vulnify": {
      "url": "https://mcp.vulnify.io/mcp",
      "headers": {
        "Authorization": "Bearer ${env:VULNIFY_API_KEY}"
      }
    }
  }
}
```

The Cursor plugin in this repo (`.cursor-plugin/plugin.json`) points at the remote URL and declares `VULNIFY_API_KEY` as a variable. Set the key in Cursor under Plugins → Configure. The value is not stored in the repo. The plugin is not usable until the URL is deployed.

### Claude Code

```bash
claude mcp add --transport http vulnify https://mcp.vulnify.io/mcp --header "Authorization: Bearer vln_test_your_key"
```

Prefer an environment variable over a key written into the shell history when you can. Claude Code stores the header in its local MCP config. This is Claude Code on your machine. It is not the Claude connectors directory.

### VS Code

```json
{
  "servers": {
    "vulnify": {
      "type": "http",
      "url": "https://mcp.vulnify.io/mcp",
      "headers": {
        "Authorization": "Bearer ${env:VULNIFY_API_KEY}"
      }
    }
  }
}
```

### Other Streamable HTTP clients

- URL: `https://mcp.vulnify.io/mcp`
- Header: `Authorization: Bearer <api-key>` or `X-Vulnify-Key: <api-key>`
- Missing or invalid credentials: HTTP 401, with `WWW-Authenticate: Bearer`
- Health check, no credentials: `GET https://mcp.vulnify.io/health`
