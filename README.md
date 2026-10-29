<p align="center">
  <img src="https://raw.githubusercontent.com/vulnify/vulnify-mcp/main/.github/assets/logo.png" alt="Vulnify" width="88" />
</p>

<h1 align="center">Vulnify MCP</h1>

<p align="center">
  Ask Vulnify before an AI agent reads, writes, deletes, exports, or sends data.<br />
  finalDecision is the authoritative result: <strong>ALLOW</strong>, <strong>REVIEW</strong>, or <strong>BLOCK</strong>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vulnify/mcp"><img alt="npm version" src="https://img.shields.io/npm/v/@vulnify/mcp?color=3D6DFF" /></a>
  <a href="https://www.npmjs.com/package/@vulnify/mcp"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@vulnify/mcp?color=3D6DFF" /></a>
  <a href="https://github.com/vulnify/vulnify-mcp/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/github/license/vulnify/vulnify-mcp?color=3D6DFF" /></a>
  <a href="https://github.com/vulnify/vulnify-mcp/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/vulnify/vulnify-mcp/ci.yml?branch=main&amp;label=CI" /></a>
</p>

<p align="center">
  <a href="https://claude.ai/directory/vulnify"><strong>Connect to Claude</strong></a>
  &nbsp;·&nbsp;
  <a href="https://docs.vulnify.io/mcp/">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/vulnify/vulnify-mcp">MCP</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/vulnify/vulnify-mcp/blob/main/CHANGELOG.md">Changelog</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/vulnify/vulnify-sdk">Node SDK</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/vulnify/vulnify-mcp/main/.github/assets/banner.png" alt="Every agent action gets a decision. ALLOW, REVIEW, or BLOCK." width="800" />
</p>

`@vulnify/mcp` is the MCP server for [Vulnify](https://docs.vulnify.io), a runtime authorization layer for AI agents. The agent asks first. This process proxies `https://api.vulnify.io`. It does not store events or API keys.

Sign in with Vulnify (OAuth 2.1) at [`https://mcp.vulnify.io/mcp`](https://mcp.vulnify.io/mcp). That hosted server speaks stateless Streamable HTTP. The local path is `npx -y @vulnify/mcp` with `VULNIFY_API_KEY`.

`check_action` is a dry run. It skips the PII scan and records nothing. `decide_action` records a real decision. A `REVIEW` waits for a person. This server cannot approve or deny one.

Application code that should decide inside your own process uses the [Node SDK](https://github.com/vulnify/vulnify-sdk) (`@vulnify/sdk`). This package does not depend on the SDK. The SDK turns some transport failures into a fail-closed decision. This server returns those failures as MCP tool errors, so a model does not read them as `ALLOW`.

## Quickstart

The source of truth is [docs.vulnify.io/mcp](https://docs.vulnify.io/mcp/). The same steps are in [docs/clients.md](docs/clients.md).

### Sign in with Vulnify

Connect to `https://mcp.vulnify.io/mcp`. Leave API-key and OAuth client fields empty. The client receives HTTP 401 and:

```
WWW-Authenticate: Bearer realm="https://mcp.vulnify.io/mcp", resource_metadata="https://mcp.vulnify.io/.well-known/oauth-protected-resource/mcp", scope="decisions:read decisions:write policies:read policies:test"
```

The body is `{"error":"unauthorized","message":"Sign in with Vulnify, or send an API key as Authorization: Bearer or X-Vulnify-Key:."}`. Protected-resource metadata lists the authorization server `https://api.vulnify.io`.

You choose an organization and allow the scopes the client requests:

| Scope | Tools |
| --- | --- |
| `decisions:read` | `get_decision` |
| `decisions:write` | `decide_action` |
| `policies:read` | `list_policies` |
| `policies:test` | `check_action`, `test_policies` |

After you allow access, the hosted server offers those five tools. `plan_policy_changes` and `check_mcp_tool_call` are not in that list. They need an API key. A missing scope comes back as a tool error that names the scope. That error is not an `ALLOW`. Revoke the connection under Settings > Connected apps: [app.vulnify.io/settings/connected-apps](https://app.vulnify.io/settings/connected-apps).

#### Claude

Vulnify is available in Claude's connector directory: **[Connect to Claude](https://claude.ai/directory/vulnify)**. Select Connect on the listing, then sign in with Vulnify. Walkthrough: [human approval for Claude actions](https://docs.vulnify.io/guides/claude-connector-approval/?utm_source=github&utm_medium=community&utm_campaign=vulnify-mcp).

To add it by URL instead, open Settings > Connectors > Add custom connector. Set the URL to `https://mcp.vulnify.io/mcp`. Do not paste an API key. Add Vulnify in Claude opens that dialog with the name and URL filled in. Claude then starts Sign in with Vulnify.

#### Cursor

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

#### Grok

Open [grok.com/connectors](https://grok.com/connectors), then New Connector > Custom. Name it `Vulnify`. Set the URL to `https://mcp.vulnify.io/mcp`. Leave the OAuth fields empty. Grok starts Sign in with Vulnify.

#### Claude Code

Add the Vulnify marketplace, then install the plugin. It connects to `https://mcp.vulnify.io/mcp` and signs in with Vulnify. A PreToolUse hook checks risky tool calls before they run. Claude Code asks for an API key for that hook when you enable the plugin. The hosted tools still use sign-in, not that key.

```bash
claude plugin marketplace add vulnify/vulnify-mcp
claude plugin install vulnify@vulnify-mcp
```

Inside a session:

```
/plugin marketplace add vulnify/vulnify-mcp
/plugin install vulnify@vulnify-mcp
```

To add only the hosted server, without the hook:

```bash
claude mcp add --transport http vulnify https://mcp.vulnify.io/mcp
```

Claude Code then signs in. Do not pass an API key on this command.

### API key or local npx

Use an API key when you need `plan_policy_changes` or `check_mcp_tool_call`, when the client cannot open a browser, or when the key has an IP allowlist. The local process needs Node.js 20 or newer and reads `VULNIFY_API_KEY`. It does not open the OAuth consent page.

```bash
npx -y @vulnify/mcp
```

```bash
VULNIFY_API_KEY=vln_live_... npx -y @vulnify/mcp
```

The key is `vln_live_...` or `vln_test_...`. A `TEST` key stores sandbox events. Those stay out of the main dashboards.

On the hosted server, both headers still work. Send the key on every request:

```
Authorization: Bearer <key>
X-Vulnify-Key: <key>
```

An API-key session lists all seven tools.

Cursor, hosted:

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

Cursor, local:

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

Claude Code with an API key:

```bash
claude mcp add --transport http vulnify https://mcp.vulnify.io/mcp --header "Authorization: Bearer vln_test_your_key"
```

Prefer an environment variable over a key written into the shell history. For sign-in, use the Claude Code command with no header. The plugin hook asks for its own API key when you enable it. Do not put that key on `claude mcp add`.

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

VS Code, `.vscode/mcp.json`, hosted:

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

VS Code, local:

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

## How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/vulnify/vulnify-mcp/main/.github/assets/how-it-works.svg" alt="An agent action goes to Vulnify. finalDecision is ALLOW (the action may run), REVIEW (a person decides), or BLOCK (the action does not run)." width="720" />
</p>

The `finalDecision` field is the authoritative result. A tool error is not an `ALLOW`.

## Tools

Every tool has a title and `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. Hints tell the client how to present the tool. They do not change what the tool does.

| Tool | API | Records? | readOnlyHint | Notes |
| --- | --- | --- | --- | --- |
| `check_action` | `POST /v1/policies/test` (one case) | No | true | Skips the PII scan and records nothing. No event id. |
| `decide_action` | `POST /v1/events` | Yes | false | Writes a security event and an audit entry. `finalDecision` is the authoritative result. |
| `get_decision` | `GET /v1/events/{id}` | No | true | Reads a decision. Optional wait polls a `REVIEW` until `ALLOW` or `BLOCK` (30 seconds max). |
| `list_policies` | `GET /v1/policies` | No | true | Policies as code, sorted by name. |
| `test_policies` | `POST /v1/policies/test` | No | true | Up to 200 cases. Skips the PII scan. Proposed `policies` are not saved. |
| `plan_policy_changes` | `POST /v1/policies/apply` | No | true | `dryRun` is forced to true. Needs an org-wide LIVE key. |
| `check_mcp_tool_call` | `POST /v1/gateway/mcp` | Yes | false | Maps a tool name to an action and records the decision. Does not run the tool. |

`destructiveHint` is false on every tool. `openWorldHint` is false on every tool, because each call stays inside the caller's own Vulnify organization. `idempotentHint` is true for the read-only tools and false for `decide_action` and `check_mcp_tool_call`. An `idempotencyKey` makes a retry of a recorded decision return the same event.

Policy list, test, and plan calls are limited to 60 requests per minute per key. Batch dry runs with `test_policies`. `POST /v1/events` has its own limit. The OpenAPI text says only that the limit was exceeded.

## Safety

This server cannot change a review and cannot save a policy.

- There is no approve tool and no deny tool. A human resolves a `REVIEW` in Vulnify.
- There is no apply tool. `plan_policy_changes` calls `POST /v1/policies/apply` with `dryRun: true` on every request. The tool input has no `dryRun` field. The server sets `dryRun` last, so a caller cannot turn the dry run off. The tool returns the diff.
- `POST /v1/gateway/http` is not a tool. On `ALLOW`, that API endpoint forwards the HTTP call. This server does not.

`plan_policy_changes` needs an org-wide LIVE key. A TEST key or an agent-bound key gets 403. An OAuth session does not list `plan_policy_changes` or `check_mcp_tool_call`.

## OAuth scopes

User login is the hosted HTTP server. The local stdio process still uses an API key. The hosted server maps tools to scopes:

| Tool | Scope | OAuth route |
| --- | --- | --- |
| `check_action` | `policies:test` | `POST /v1/mcp/policies/test` |
| `test_policies` | `policies:test` | `POST /v1/mcp/policies/test` |
| `decide_action` | `decisions:write` | `POST /v1/mcp/events` |
| `get_decision` | `decisions:read` | `GET /v1/mcp/events/{id}` |
| `list_policies` | `policies:read` | `GET /v1/mcp/policies` |
| `plan_policy_changes` | API key and stdio only | Omitted from OAuth `tools/list` |
| `check_mcp_tool_call` | API key and stdio only | Omitted from OAuth `tools/list` |

A token that is missing the scope gets a tool error that names the scope. That error is not an `ALLOW`. Active introspection results are reused for at most 60 seconds, and never past `exp`.

## Distinct from the MCP gateway

`https://mcp.vulnify.io/mcp` (and the local stdio process) is the server an MCP client connects to. The client then calls the tools above.

`check_mcp_tool_call` is different. It sends one tool call to `POST /v1/gateway/mcp` on `api.vulnify.io`, records the decision, and stops. It does not execute the tool, and connecting a client to this server does not call that gateway.

## IP allowlists

An API key can list allowed source IPs. Calls through `https://mcp.vulnify.io/mcp` with that key come from the hosted server's egress address, not from the machine where Cursor or VS Code is running. An allowlist that only contains an office or laptop address rejects the hosted server. Use `npx -y @vulnify/mcp` on a host whose address is on the list. Sign in with Vulnify does not send that API key.

## Product

The screenshot is from a demo workspace. The agent is `SupportBot`.

<p align="center">
  <img src="https://raw.githubusercontent.com/vulnify/vulnify-mcp/main/.github/assets/allow-detail.png" alt="An allowed read: SupportBot, one record, internal destination, low risk." width="800" />
</p>

Audit exports in the Vulnify app are a JSON or CSV download that includes a SHA-256 checksum. SIEM export is JSON or CEF lines.

## Configuration

| Variable | Where | Required | Purpose |
| --- | --- | --- | --- |
| `VULNIFY_API_KEY` | stdio process | yes | API key (`vln_live_...` or `vln_test_...`). HTTP does not fall back to this variable. |
| `VULNIFY_BASE_URL` | both | no | API base URL. Default `https://api.vulnify.io`. |
| `OAUTH_INTROSPECTION_SECRET` | HTTP | for user login | Bearer secret for `POST /oauth/introspect`. Stays on the server. API keys work without it. |
| `OPENAI_APPS_CHALLENGE` | HTTP | no | When set, `GET /.well-known/openai-apps-challenge` returns this value as `text/plain`. Unset, that path is 404. |
| `PORT` | HTTP | no | Listen port. Default `8080`. |
| `HOST` | HTTP | no | Bind address. Default `0.0.0.0`. |

Use an **agent-bound LIVE** key when a recorded decision should count for one agent. `plan_policy_changes` needs an **org-wide LIVE** key.

`VULNIFY_TEST_API_KEY` is only for `npm run test:live`. The server does not read it.

## HTTP server

```bash
npx -y @vulnify/mcp --http
```

The container runs the HTTP server as a non-root user:

```bash
docker build -t vulnify-mcp .
docker run --rm -p 8080:8080 -e PORT=8080 vulnify-mcp
```

No API key is required to start the container. Send the key on each request.

```bash
curl -sS localhost:8080/health
curl -sS -o /dev/null -w '%{http_code}\n' -X POST localhost:8080/mcp \
  -H 'content-type: application/json' -d '{}'
```

The health check prints JSON. The POST without a key prints `401`.

`GET /.well-known/mcp/server-card.json` does not require a key. It lists the tools the server registers (names, descriptions, and input schemas), states that you can sign in with OAuth or send a Vulnify API key in a header, and links to the docs and this repository.

```bash
curl -sS https://mcp.vulnify.io/.well-known/mcp/server-card.json
```

## Errors

Tool failures are MCP tool errors (`isError`). The API key is not included.

| Status | Meaning |
| --- | --- |
| 401 | The API key or access token is missing, invalid, revoked, or expired. |
| 403 | The key is bound to another agent, the caller IP is not allowlisted, the access token lacks a scope, or `plan_policy_changes` was called without an org-wide LIVE key. |
| 413 | The JSON body is over the API's 200 KB limit. |
| 429 | The key is rate limited. Policy calls are 60 per minute. Retry a recorded decision with the same `idempotencyKey`. |

## Security

Report a vulnerability to [security@vulnify.io](mailto:security@vulnify.io). The disclosure policy is at [vulnify.io/disclosure](https://www.vulnify.io/disclosure). See [SECURITY.md](SECURITY.md).

Keys are not logged. Request logs are method, path, and status. `content` sent for a sensitive-data scan is forwarded to the API and is not written to this server's logs. The API scans that text in memory and does not store it.

This package does not run a shell and does not register hooks. Do not put a key in a tool argument or in a committed config file.

Network endpoints this process uses:

- `https://api.vulnify.io` (or `VULNIFY_BASE_URL`) for every tool call, and for `GET /v1/policies` when an API key is checked. An API key is sent as `Authorization: Bearer` to `/v1/*`. A user access token is sent as `Authorization: Bearer` to `/v1/mcp/*`.
- `POST /oauth/introspect` on that same origin, with `Authorization: Bearer` set to `OAUTH_INTROSPECTION_SECRET`, to validate `vln_oat_...` tokens. The secret is not sent to clients and is not logged.
- `https://mcp.vulnify.io/mcp` is the hosted HTTP transport. The server process does not call that URL.

## Development

```bash
npm install
npm test
npm run lint
npm run build
```

`npm run test:live` calls `list_policies` on `https://api.vulnify.io` when `VULNIFY_TEST_API_KEY` is set, and skips when it is not. It does not record an event.

Publishing is described in [RELEASING.md](RELEASING.md).

## License

MIT. Copyright 2026 Vulnify.
