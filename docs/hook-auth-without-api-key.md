# Claude Code hook without a hand-made API key (design, not built yet)

Today the PreToolUse hook needs an API key (plugin option `vulnify_api_key`). Without one it does not check
anything (`no Vulnify API key is set`). The MCP connection itself already uses OAuth and needs no key.

Two ways to drop the manual key step. Neither is built in this change; both need API work first.

1. **Device flow (preferred).** The hook runs `vulnify login` style OAuth 2.0 Device Authorization (RFC 8628)
   on first use: it prints a short code and `https://app.vulnify.io/device`, the user approves in the browser,
   and the hook stores a refresh token in the Claude Code plugin data dir (`${CLAUDE_PLUGIN_DATA}`, mode 0600).
   Needs: `/oauth/device_authorization` + device grant on the API, a `decisions:write`-only scope, refresh
   token rotation, and a hook path that never blocks the tool call while waiting (degrade, then pick up the
   token on the next call).
2. **One-click scoped key.** A "Connect Claude Code" button in the app mints a key bound to one agent
   (`claude-code`), `decisions:write` only, and shows the single `claude plugin install` line with the key
   already filled in. Smaller API change (key scopes + agent binding exist), but the key still passes through
   the user's clipboard.

Why not reuse the MCP OAuth token: Claude Code keeps that token inside its MCP client and does not expose it
to hooks, and reading it from Claude Code's credential store would be reading another app's secret.

Until then, the zero-config path is the hosted MCP server: its instructions ask the model to call
`decide_action` before risky actions, and the `vulnify_quickstart` prompt records one sample decision.
