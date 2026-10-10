<p align="center">
  <img src="https://raw.githubusercontent.com/vulnify/vulnify-mcp/main/.github/assets/logo.png" alt="Vulnify" width="88" />
</p>

<h1 align="center">Vulnify MCP</h1>

<p align="center">
  Ask Vulnify before an AI agent reads, writes, deletes, exports, or sends data.<br />
  The outcome to obey is <strong>ALLOW</strong>, <strong>REVIEW</strong>, or <strong>BLOCK</strong>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vulnify/mcp"><img alt="npm version" src="https://img.shields.io/npm/v/@vulnify/mcp?color=3D6DFF" /></a>
  <a href="https://www.npmjs.com/package/@vulnify/mcp"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@vulnify/mcp?color=3D6DFF" /></a>
  <a href="https://github.com/vulnify/vulnify-mcp/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/github/license/vulnify/vulnify-mcp?color=3D6DFF" /></a>
  <a href="https://github.com/vulnify/vulnify-mcp/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/vulnify/vulnify-mcp/ci.yml?branch=main&amp;label=CI" /></a>
</p>

<p align="center">
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

Two transports, one server:

- **stdio** for a local client: `npx -y @vulnify/mcp`
- **stateless Streamable HTTP** at [`https://mcp.vulnify.io/mcp`](https://mcp.vulnify.io/mcp)

`check_action` is a dry run. It skips the PII scan and records nothing. `decide_action` records a real decision. A `REVIEW` waits for a person. This server cannot approve or deny one.

Application code that should decide inside your own process uses the [Node SDK](https://github.com/vulnify/vulnify-sdk) (`@vulnify/sdk`). This package does not depend on the SDK. The SDK turns some transport failures into a fail-closed decision. This server returns those failures as MCP tool errors, so a model does not read them as `ALLOW`.

## Quickstart

Node.js 20 or newer. Use a dedicated **TEST** key (`vln_test_...`) to try a client. The hosted guide is [docs.vulnify.io/mcp](https://docs.vulnify.io/mcp/). Client snippets for Cursor, Claude Code, Claude Desktop, and VS Code are in [docs/clients.md](docs/clients.md).

### Local stdio

```bash
npx -y @vulnify/mcp
```

Cursor (`.cursor/mcp.json`):

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

### Remote Streamable HTTP

[`https://mcp.vulnify.io/mcp`](https://mcp.vulnify.io/mcp) is the hosted server. Send the API key on every request. The server keeps no session.

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

`X-Vulnify-Key: <key>` is accepted as well. A request with no key gets **401** and `WWW-Authenticate: Bearer`. `GET /health` does not require a key. Responses are JSON.

One-click Grok connectors and the Claude connectors directory authenticate with OAuth. This server does not implement OAuth yet (planned for v1.1), so there is no one-click install for those products. Use `npx -y @vulnify/mcp` with Cursor, Claude Code, Claude Desktop, or VS Code. Remote snippets are in [docs/clients.md](docs/clients.md#remote-url).

## How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/vulnify/vulnify-mcp/main/.github/assets/how-it-works.svg" alt="An agent action goes to Vulnify. finalDecision is ALLOW (the action may run), REVIEW (a person decides), or BLOCK (the action does not run)." width="720" />
</p>

Obey `finalDecision`. A tool error is not an `ALLOW`.

## Tools

Every tool has a title and `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. Hints tell the client how to present the tool. They do not change what the tool does.

| Tool | API | Records? | readOnlyHint | Notes |
| --- | --- | --- | --- | --- |
| `check_action` | `POST /v1/policies/test` (one case) | No | true | Skips the PII scan and records nothing. No event id. |
| `decide_action` | `POST /v1/events` | Yes | false | Writes a security event and an audit entry. Obey `finalDecision`. |
| `get_decision` | `GET /v1/events/{id}` | No | true | Reads a decision. Optional wait polls a `REVIEW` until `ALLOW` or `BLOCK` (30 seconds max). |
| `list_policies` | `GET /v1/policies` | No | true | Policies as code, sorted by name. |
| `test_policies` | `POST /v1/policies/test` | No | true | Up to 200 cases. Skips the PII scan. Proposed `policies` are not saved. |
| `plan_policy_changes` | `POST /v1/policies/apply` | No | true | `dryRun` is forced to true. Needs an org-wide LIVE key. |
| `check_mcp_tool_call` | `POST /v1/gateway/mcp` | Yes | false | Maps a tool name to an action and records the decision. Does not run the tool. |

`destructiveHint` is false on every tool. `openWorldHint` is true on every tool, because each call reads or writes organization state at the Vulnify API. `idempotentHint` is true for the read-only tools and false for `decide_action` and `check_mcp_tool_call`. Pass `idempotencyKey` so a retry does not record a second event.

Policy list, test, and plan calls are limited to 60 requests per minute per key. Batch dry runs with `test_policies`. `POST /v1/events` has its own limit. The OpenAPI text says only that the limit was exceeded.

## Safety

This server cannot change a review and cannot save a policy.

- There is no approve tool and no deny tool. A human resolves a `REVIEW` in Vulnify.
- There is no apply tool. `plan_policy_changes` calls `POST /v1/policies/apply` with `dryRun: true` on every request. The tool input has no `dryRun` field. The server sets `dryRun` last, so a caller cannot turn the dry run off. The tool returns the diff.
- `POST /v1/gateway/http` is not a tool. On `ALLOW`, that API endpoint forwards the HTTP call. This server does not.

`plan_policy_changes` needs an org-wide LIVE key. A TEST key or an agent-bound key gets 403.

## Distinct from the MCP gateway

`https://mcp.vulnify.io/mcp` (and the local stdio process) is the server an MCP client connects to. The client then calls the tools above.

`check_mcp_tool_call` is different. It sends one tool call to `POST /v1/gateway/mcp` on `api.vulnify.io`, records the decision, and stops. It does not execute the tool, and connecting a client to this server does not call that gateway.

## IP allowlists

API-key IP allowlists are checked against the hosted server's egress IP when using `https://mcp.vulnify.io/mcp`, not the end user's IP. The hosted process calls `api.vulnify.io` from its own address. Users who need an IP allowlist should run the local npx/stdio mode (`npx -y @vulnify/mcp`). stdio runs on the user's machine, so the allowlist sees that machine.

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

## Errors

Tool failures are MCP tool errors (`isError`). The API key is not included.

| Status | Meaning |
| --- | --- |
| 401 | The API key is missing, invalid, revoked, or expired. |
| 403 | The key is bound to another agent, the caller IP is not allowlisted, or `plan_policy_changes` was called without an org-wide LIVE key. |
| 413 | The JSON body is over the API's 200 KB limit. |
| 429 | The key is rate limited. Policy calls are 60 per minute. Retry a recorded decision with the same `idempotencyKey`. |

## Security

Report a vulnerability to [security@vulnify.io](mailto:security@vulnify.io). The disclosure policy is at [vulnify.io/disclosure](https://www.vulnify.io/disclosure). See [SECURITY.md](SECURITY.md).

Keys are not logged. Request logs are method, path, and status. `content` sent for a sensitive-data scan is forwarded to the API and is not written to this server's logs. The API scans that text in memory and does not store it.

This package does not run a shell and does not register hooks. Do not put a key in a tool argument or in a committed config file.

Network endpoints this process uses:

- `https://api.vulnify.io` (or `VULNIFY_BASE_URL`) for every tool call. The key is sent as `Authorization: Bearer`.
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
