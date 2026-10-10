# Use Vulnify with Cursor, Claude, Grok or your code

The Vulnify MCP server lets an agent ask whether an action may run. Run it locally with `npx -y @vulnify/mcp` and `VULNIFY_API_KEY`, or connect to the hosted server at `https://mcp.vulnify.io/mcp`. The guide is at [https://docs.vulnify.io/mcp/](https://docs.vulnify.io/mcp/).

`check_action` previews a decision. It skips the PII scan and records nothing. `decide_action` records a decision. A `REVIEW` is not approval. This server cannot approve or deny a review.

Create a dedicated TEST key (`vln_test_...`) to try an API-key client. Set `VULNIFY_BASE_URL` only when the API is not `https://api.vulnify.io`.

A Claude custom connector does not use a key. Add the URL and sign in. See [Claude custom connector](#claude-custom-connector). API-key snippets for Cursor, Claude Code, Claude Desktop, and VS Code are below. Hosted API-key snippets are in [Remote URL](#remote-url).

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

A custom connector in Claude does not use this file and does not use an API key. Add `https://mcp.vulnify.io/mcp` and sign in. See [Claude custom connector](#claude-custom-connector).

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

The `finalDecision` field is the authoritative result. `REVIEW` and `BLOCK` mean the export was not allowed. The SDK records that call (`POST /v1/events`), the same as `decide_action`. For a dry run that records nothing, use this MCP server's `check_action` or the CLI `vulnify test`. Full SDK documentation is at https://docs.vulnify.io.

If the SDK cannot reach Vulnify, the default is a fail-closed decision, not a thrown tool error. The MCP server returns an error instead, so an agent does not read a fallback as `ALLOW`.

## Security

API-key IP allowlists are checked against the hosted server's egress IP when using `https://mcp.vulnify.io/mcp`, not the end user's IP. Users who need an IP allowlist should run the local npx/stdio mode (`npx -y @vulnify/mcp`) instead.

Do not put the API key in a tool argument, a URL, or a committed config file. The local process reads `VULNIFY_API_KEY` from the environment. The hosted server reads `Authorization: Bearer <key>` or `X-Vulnify-Key` on each request and does not log the key.

## Claude custom connector

In Claude, add a custom connector and paste this URL only:

`https://mcp.vulnify.io/mcp`

Do not enter an API key. Claude calls that URL, reads the 401 `WWW-Authenticate` challenge, and opens Vulnify sign-in. Approve access on the consent page. Claude then calls the server with your user access token (`vln_oat_...`).

| Tool | Scope |
| --- | --- |
| `check_action` | `policies:test` |
| `test_policies` | `policies:test` |
| `decide_action` | `decisions:write` |
| `get_decision` | `decisions:read` |
| `list_policies` | `policies:read` |

`plan_policy_changes` and `check_mcp_tool_call` need an API key. An OAuth session gets an error that says so. This server has no approve tool and no deny tool.

## Remote URL

These snippets connect to the hosted server at `https://mcp.vulnify.io/mcp` with an API key. For Claude, use the [custom connector](#claude-custom-connector) and omit the key.

API-key IP allowlists are checked against the hosted server's egress IP when using `https://mcp.vulnify.io/mcp`, not the end user's IP. Users who need an IP allowlist should run the local npx/stdio mode (`npx -y @vulnify/mcp`) instead.

The server does not keep a session. Send the key on every API-key request. A request with no credentials gets 401 and:

```
WWW-Authenticate: Bearer realm="https://mcp.vulnify.io/mcp", resource_metadata="https://mcp.vulnify.io/.well-known/oauth-protected-resource/mcp"
```

`GET /health` does not require a key. `GET /.well-known/oauth-protected-resource` and `GET /.well-known/oauth-protected-resource/mcp` return the same protected-resource JSON the API serves.

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

The Cursor plugin in this repo (`.cursor-plugin/plugin.json`) points at the remote URL and declares `VULNIFY_API_KEY` as a variable. Set the key in Cursor under Plugins → Configure. The value is not stored in the repo.

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
- OAuth: no header. The client signs in and sends `Authorization: Bearer vln_oat_...`
- API key header: `Authorization: Bearer <api-key>` or `X-Vulnify-Key: <api-key>`
- Missing credentials: HTTP 401, with `WWW-Authenticate: Bearer realm="https://mcp.vulnify.io/mcp", resource_metadata="https://mcp.vulnify.io/.well-known/oauth-protected-resource/mcp"`
- A refresh token (`vln_ort_...`), a `vln_oac_...` credential, an unrecognized secret, or an API key the API rejects: HTTP 401, with that same challenge and `error="invalid_token"`
- Health check, no credentials: `GET https://mcp.vulnify.io/health`
