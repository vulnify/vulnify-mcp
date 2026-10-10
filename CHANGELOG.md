# Changelog

## 0.1.0

First release of `@vulnify/mcp`.

- stdio transport via `npx -y @vulnify/mcp`, configured with `VULNIFY_API_KEY` and optional `VULNIFY_BASE_URL`.
- Stateless Streamable HTTP at `/mcp`, with `GET /health`. Missing credentials return 401. The API key is taken from `Authorization: Bearer` or `X-Vulnify-Key` and is not logged.
- Tools: `check_action`, `decide_action`, `get_decision`, `list_policies`, `test_policies`, `plan_policy_changes`, `check_mcp_tool_call`.
- `plan_policy_changes` forces `dryRun: true`. There is no apply tool and no approve or deny tool.
