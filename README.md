# @vulnify/mcp

Vulnify is a runtime authorization layer for AI agents. This package is the MCP server. An agent asks Vulnify before it reads, writes, deletes, exports, or sends data. The outcome to obey is `finalDecision`: `ALLOW`, `REVIEW`, or `BLOCK`.

`check_action` is a dry run. It skips the PII scan and records nothing. `decide_action` records a real decision. A `REVIEW` waits for a person. This server cannot approve or deny one.

The same code speaks two transports:

- **stdio** for local clients: `npx -y @vulnify/mcp`
- **stateless Streamable HTTP** at `/mcp`, to be deployed at `https://mcp.vulnify.io/mcp`

Production API: `https://api.vulnify.io`. This server is a thin proxy. It does not store events or keys.

Documentation for clients: [docs/clients.md](docs/clients.md).

## Tools

Every tool has a title and `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` annotations. Hints tell the client how to present the tool. They do not change what the tool does.

| Tool | API | Records? | readOnlyHint | Notes |
| --- | --- | --- | --- | --- |
| `check_action` | `POST /v1/policies/test` (one case) | No | true | Skips the PII scan and records nothing. No event id. |
| `decide_action` | `POST /v1/events` | Yes | false | Writes a security event and an audit entry. Obey `finalDecision`. |
| `get_decision` | `GET /v1/events/{id}` | No | true | Reads a decision. Optional wait polls a `REVIEW` until `ALLOW` or `BLOCK` (30 seconds max). |
| `list_policies` | `GET /v1/policies` | No | true | Policies as code, sorted by name. |
| `test_policies` | `POST /v1/policies/test` | No | true | Up to 200 cases. Skips the PII scan. Proposed `policies` are not saved. |
| `plan_policy_changes` | `POST /v1/policies/apply` | No | true | `dryRun` is forced to true and cannot be turned off. Needs an org-wide LIVE key. |
| `check_mcp_tool_call` | `POST /v1/gateway/mcp` | Yes | false | Maps a tool name to an action and records the decision. Does not run the tool. |

`destructiveHint` is false on every tool. `openWorldHint` is true on every tool, because each call reads or writes organization state at the Vulnify API. `idempotentHint` is true for the read-only tools and false for `decide_action` and `check_mcp_tool_call` (pass `idempotencyKey` so a retry does not record a second event).

There is no approve tool, no deny tool, and no tool that applies policy changes. A human resolves a `REVIEW` in Vulnify. `plan_policy_changes` only returns the diff.

`POST /v1/gateway/http` is not exposed. On `ALLOW` that endpoint forwards the HTTP call.

Policy list, test, and plan calls are limited to 60 requests per minute per key. Batch dry runs with `test_policies`. `POST /v1/events` has its own limit; the OpenAPI text says only that the limit was exceeded.

## Install

Node.js 20 or newer.

### stdio

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

`X-Vulnify-Key: <key>` is accepted as well. A request with no key gets **401** and `WWW-Authenticate: Bearer`. `GET /health` does not require a key.

The HTTP server is stateless: one MCP server per request, no session store. Any replica can serve any call. Responses are JSON rather than a long-lived SSE stream.

More clients, and the ones that do not work with an API key yet: [docs/clients.md](docs/clients.md).

## Environment

| Variable | Where | Required | Purpose |
| --- | --- | --- | --- |
| `VULNIFY_API_KEY` | stdio process | yes | API key (`vln_live_...` or `vln_test_...`). Not used as a fallback for HTTP. |
| `VULNIFY_BASE_URL` | both | no | API base URL. Default `https://api.vulnify.io`. |
| `PORT` | HTTP | no | Listen port. Default `8080`. |
| `HOST` | HTTP | no | Bind address. Default `0.0.0.0`. |

Use a dedicated **TEST** key to try the server. Use an **agent-bound LIVE** key when a recorded decision should count for one agent. `plan_policy_changes` needs an **org-wide LIVE** key. A TEST key or an agent-bound key gets 403 on that tool.

`VULNIFY_TEST_API_KEY` is only for `npm run test:live`. It is not read by the server.

## HTTP server

```bash
npx -y @vulnify/mcp --http
```

Docker (image runs the HTTP server as a non-root user):

```bash
docker build -t vulnify-mcp:0.1.0 .
docker run --rm -p 8080:8080 -e PORT=8080 vulnify-mcp:0.1.0
```

Optional: `-e VULNIFY_BASE_URL=https://api.vulnify.io`. No API key is required to start the container. Send the key on each request.

```bash
curl -sS localhost:8080/health
curl -sS -o /dev/null -w '%{http_code}\n' -X POST localhost:8080/mcp -H 'content-type: application/json' -d '{}'
```

The health check prints JSON. The POST without a key prints `401`.

## Security

Network endpoints this process uses:

- `https://api.vulnify.io` (or `VULNIFY_BASE_URL`) for every tool call. The key is sent as `Authorization: Bearer`.
- `https://mcp.vulnify.io/mcp` is where the HTTP transport is meant to be deployed. It is not called by the server itself.

Credentials:

- stdio reads `VULNIFY_API_KEY` from the environment.
- HTTP reads `Authorization: Bearer <key>` or `X-Vulnify-Key` per request.

Keys are not logged. Request logs are method, path, and status. `content` sent for a sensitive-data scan is forwarded to the API and is not written to this server's logs. The API scans that text in memory and does not store it.

An API-key IP allowlist is checked by `api.vulnify.io` against the caller it sees. stdio runs on the user's machine, so the allowlist sees that machine. The hosted MCP server calls the API from its own egress address. A key allowlisted to an office IP will be refused through the hosted server unless that egress address is allowed too.

This package does not run a shell, does not register hooks, and does not approve reviews. Do not put a key in a tool argument or in a committed config file.

`@vulnify/sdk` is a separate client for application code (`check()`, `guard()`). This server does not depend on it. The SDK turns some transport failures into a fail-closed decision; this server returns those failures as MCP tool errors so the model does not confuse them with `ALLOW`.

## Errors

Tool failures are MCP tool errors (`isError`). The API key is not included.

| Status | Meaning |
| --- | --- |
| 401 | The API key is missing, invalid, revoked, or expired. |
| 403 | The key is bound to another agent, the caller IP is not allowlisted, or `plan_policy_changes` was called without an org-wide LIVE key. |
| 413 | The JSON body is over the API's 200 KB limit. |
| 429 | The key is rate limited. Policy calls are 60 per minute. Retry a recorded decision with the same `idempotencyKey`. |

## Development

```bash
npm install
npm test
npm run lint
npm run build
```

`npm run test:live` calls `list_policies` on `https://api.vulnify.io` when `VULNIFY_TEST_API_KEY` is set, and skips when it is not. It does not record an event.

Publishing is described in [RELEASING.md](RELEASING.md). Do not publish from a laptop as part of normal releases.

## License

MIT. Copyright 2026 Vulnify.
