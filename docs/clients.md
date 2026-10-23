# Use Vulnify with Cursor, Claude, Grok or your code

The Vulnify MCP server lets an agent ask whether an action may run. The primary path is Sign in with Vulnify at `https://mcp.vulnify.io/mcp`. The guide is [https://docs.vulnify.io/mcp/](https://docs.vulnify.io/mcp/).

`check_action` previews a decision. It skips the PII scan and records nothing. `decide_action` records a decision. A `REVIEW` is not approval. This server cannot approve or deny a review.

## Sign in with Vulnify

Connect to `https://mcp.vulnify.io/mcp`. The server speaks Streamable HTTP and keeps no session. Leave API-key and OAuth client fields empty. The client receives HTTP 401 and:

```
WWW-Authenticate: Bearer realm="https://mcp.vulnify.io/mcp", resource_metadata="https://mcp.vulnify.io/.well-known/oauth-protected-resource/mcp", scope="decisions:read decisions:write policies:read policies:test reviews:read reviews:decide"
```

The body is `{"error":"unauthorized","message":"Sign in with Vulnify, or send an API key as Authorization: Bearer or X-Vulnify-Key:."}`. Protected-resource metadata lists the authorization server `https://api.vulnify.io`.

You choose an organization and allow the scopes the client requests:

| Scope | Tools |
| --- | --- |
| `decisions:read` | `get_decision` |
| `decisions:write` | `decide_action` |
| `policies:read` | `list_policies` |
| `policies:test` | `check_action`, `test_policies` |
| `reviews:read` | `list_pending_reviews` |
| `reviews:decide` (owners and admins) | `approve_review`, `deny_review` |

After you allow access, the hosted server offers those tools (five, plus the review tools your role allows). `plan_policy_changes` and `check_mcp_tool_call` are not in that list. They need an API key, through a manual config or local `npx -y @vulnify/mcp`. A missing scope comes back as a tool error that names the scope. That error is not an `ALLOW`.

Revoke the connection under Settings > Connected apps: [app.vulnify.io/settings/connected-apps](https://app.vulnify.io/settings/connected-apps).

### Claude

In Claude, open Settings > Connectors > Add custom connector. Set the URL to `https://mcp.vulnify.io/mcp`. Do not paste an API key.

Add Vulnify in Claude opens that dialog with the name and URL filled in. Claude then starts Sign in with Vulnify.

### Cursor

[Install in Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=vulnify&config=eyJ1cmwiOiJodHRwczovL21jcC52dWxuaWZ5LmlvL21jcCJ9) adds the hosted server and starts sign-in.

The same server in `.cursor/mcp.json`, or in `~/.cursor/mcp.json`, is the URL with no header:

```json
{
  "mcpServers": {
    "vulnify": {
      "url": "https://mcp.vulnify.io/mcp"
    }
  }
}
```

The Cursor plugin in this repo (`.cursor-plugin/plugin.json`) points at that URL.

### Grok

Open [grok.com/connectors](https://grok.com/connectors), then New Connector > Custom. Name it `Vulnify`. Set the URL to `https://mcp.vulnify.io/mcp`. Leave the OAuth fields empty. Grok starts Sign in with Vulnify.

### Claude Code

```bash
claude mcp add --transport http vulnify https://mcp.vulnify.io/mcp
```

Claude Code then signs in. Do not pass an API key on this command.

## API key or local npx

Use an API key when you need `plan_policy_changes` or `check_mcp_tool_call`, when the client cannot open a browser, or when the key has an IP allowlist. The local process needs Node.js 20 or newer and reads `VULNIFY_API_KEY`. It does not open the OAuth consent page.

```bash
npx -y @vulnify/mcp
```

```bash
VULNIFY_API_KEY=vln_live_... npx -y @vulnify/mcp
```

The key is `vln_live_...` or `vln_test_...`. A `TEST` key stores sandbox events. Those stay out of the main dashboards.

On the hosted server, send the key on every request. Either header works:

```
Authorization: Bearer <key>
X-Vulnify-Key: <key>
```

An API-key session lists all seven tools.

### Cursor

Hosted:

```json
{
  "mcpServers": {
    "vulnify": {
      "url": "https://mcp.vulnify.io/mcp",
      "headers": {
        "Authorization": "Bearer vln_live_..."
      }
    }
  }
}
```

Local:

```json
{
  "mcpServers": {
    "vulnify": {
      "command": "npx",
      "args": ["-y", "@vulnify/mcp"],
      "env": {
        "VULNIFY_API_KEY": "vln_live_..."
      }
    }
  }
}
```

`X-Vulnify-Key` works in place of `Authorization` on the hosted server.

### Claude Code with an API key

```bash
claude mcp add --transport http vulnify https://mcp.vulnify.io/mcp --header "Authorization: Bearer vln_test_your_key"
```

Prefer an environment variable over a key written into the shell history. For sign-in, use the Claude Code command with no header.

### Claude Desktop

Claude Desktop can run the local process. On macOS the file is `~/Library/Application Support/Claude/claude_desktop_config.json`. On Windows it is `%APPDATA%\Claude\claude_desktop_config.json`. Restart the app after saving.

```json
{
  "mcpServers": {
    "vulnify": {
      "command": "npx",
      "args": ["-y", "@vulnify/mcp"],
      "env": {
        "VULNIFY_API_KEY": "vln_live_..."
      }
    }
  }
}
```

### VS Code

`.vscode/mcp.json`, hosted:

```json
{
  "servers": {
    "vulnify": {
      "type": "http",
      "url": "https://mcp.vulnify.io/mcp",
      "headers": {
        "Authorization": "Bearer ${input:vulnify-api-key}"
      }
    }
  }
}
```

Local:

```json
{
  "servers": {
    "vulnify": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@vulnify/mcp"],
      "env": {
        "VULNIFY_API_KEY": "${input:vulnify-api-key}"
      }
    }
  }
}
```

### Your own code

An MCP client that speaks Streamable HTTP can use `https://mcp.vulnify.io/mcp` with no key and complete Sign in with Vulnify, or send `Authorization: Bearer <key>` or `X-Vulnify-Key`.

Application code that decides inside your own process uses the SDK, not this server.

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

See the [Node.js SDK](https://github.com/vulnify/vulnify-sdk). The docs page also links the Python SDK.

## IP allowlists

An API key can list allowed source IPs. Calls through the hosted server with that key come from the server's egress address, not from the machine where Cursor or VS Code is running. An allowlist that only contains an office or laptop address rejects the hosted server.

Use `npx -y @vulnify/mcp` over stdio for an allowlisted key, on a host whose address is on the list. The key stays in that process's environment. Sign in with Vulnify does not send that API key.

Do not put the API key in a tool argument, a URL, or a committed config file. The local process reads `VULNIFY_API_KEY` from the environment. The hosted server reads `Authorization: Bearer <key>` or `X-Vulnify-Key` on each request and does not log the key.
