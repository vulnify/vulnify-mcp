# Changelog

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
