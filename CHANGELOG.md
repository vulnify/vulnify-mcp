# Changelog

## Unreleased

- Hosted HTTP accepts OAuth 2.1 user access tokens (`vln_oat_...`) and still accepts `vln_live_` / `vln_test_` API keys. A request with no credentials returns 401 with the protected-resource `WWW-Authenticate` challenge. `plan_policy_changes` and `check_mcp_tool_call` stay on API-key and stdio sessions.
- An OAuth `tools/list` returns `check_action`, `decide_action`, `get_decision`, `list_policies`, and `test_policies`. The 401 challenge includes `scope="decisions:read decisions:write policies:read policies:test"`. Protected-resource metadata on `mcp.vulnify.io` lists those four scopes.
- The Cursor plugin connects to `https://mcp.vulnify.io/mcp` and signs in with Vulnify. Plugin version 0.1.3. The server card includes tool annotations.
- A `vln_ort_...` refresh token, a `vln_oac_...` credential, or any other unrecognized secret is rejected with 401 and `WWW-Authenticate` (`error="invalid_token"`) before `initialize` or `tools/list`. API keys are checked with `GET /v1/policies` on first use. A successful check is cached for at most 60 seconds under a hash of the key. A key the API rejects returns that same 401.
- Tool descriptions state that `finalDecision` is the authoritative result. Every tool keeps its title, `readOnlyHint`, and `destructiveHint`. `openWorldHint` is false because each tool stays inside the caller's own Vulnify organization.
- `GET /.well-known/openai-apps-challenge` returns `OPENAI_APPS_CHALLENGE` as `text/plain`, or 404 when that variable is unset. Tool results and errors omit checkout and upgrade links.

## 0.1.2

docs: hosted server is live, link docs.vulnify.io/mcp

- `https://mcp.vulnify.io/mcp` is the hosted server. The README and client docs no longer say it is not deployed.
- The docs link and the quickstart point at https://docs.vulnify.io/mcp/.
- The README banner shows the whole chrome falcon. The audit screenshot was removed because a cursor covered the button text.

## 0.1.1

docs: README refresh

- README for GitHub and npm: what the server does, local and remote install, the tools table, the dry-run safety rule, the hosted IP allowlist, and product screenshots.
- The package bin path is `dist/cli.js`. npm 11 rewrote `./dist/cli.js` on publish and warned that the script name was removed.

## 0.1.0

First release of `@vulnify/mcp`.

- stdio transport via `npx -y @vulnify/mcp`, configured with `VULNIFY_API_KEY` and optional `VULNIFY_BASE_URL`.
- Stateless Streamable HTTP at `/mcp`, with `GET /health`. Missing credentials return 401. The API key is taken from `Authorization: Bearer` or `X-Vulnify-Key` and is not logged.
- Tools: `check_action`, `decide_action`, `get_decision`, `list_policies`, `test_policies`, `plan_policy_changes`, `check_mcp_tool_call`.
- `plan_policy_changes` forces `dryRun: true`. There is no apply tool and no approve or deny tool.
