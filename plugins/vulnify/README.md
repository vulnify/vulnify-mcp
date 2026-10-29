# Vulnify

Runtime authorization for Claude Code. Every agent action gets a decision before it runs. `finalDecision` is the authoritative result: **ALLOW**, **REVIEW**, or **BLOCK**.

The plugin does two separate things.

The hosted MCP server at `https://mcp.vulnify.io/mcp` gives Claude the Vulnify tools. Claude Code signs in with Vulnify. After you allow access, the tools are `check_action`, `decide_action`, `get_decision`, `list_policies`, and `test_policies`. That connection uses OAuth. It does not use an API key.

A `PreToolUse` hook checks risky tool calls before they run. It is enforcement. The MCP tools are guidance: Claude decides when to call them. The hook does not wait for that. It runs `node` on `hooks/vulnify-hook.mjs` in this plugin (Node.js 18 or newer, no packages to install) and asks `https://api.vulnify.io` with `POST /v1/events`.

| Vulnify result | What Claude Code does |
| --- | --- |
| `ALLOW` | The normal permission flow continues |
| `REVIEW` | The call is denied until a person approves it at [app.vulnify.io/approvals](https://app.vulnify.io/approvals). Then ask Claude to retry |
| `BLOCK` | The call is denied, with Vulnify's reasons |
| Unreachable, missing key, or timeout | The call is denied |

The hook sends the action, resource, destination, an estimated record count, and, for send, export, delete, and web fetch calls, a clipped copy of the command or tool input. Vulnify scans that text in memory and does not store it. Read-only shell commands such as `ls` and `git status` are not sent. Vulnify's own tools are not sent. The API key is the value you enter when Claude Code enables the plugin. It is stored by Claude Code and sent only to `https://api.vulnify.io` as `Authorization: Bearer`. Create a key at [app.vulnify.io/api-keys](https://app.vulnify.io/api-keys). A TEST key keeps events in the sandbox.

Docs: [docs.vulnify.io/mcp](https://docs.vulnify.io/mcp/) and [the Claude Code hook](https://docs.vulnify.io/mcp/claude-code-hook/).

## Install

In Claude Code:

```
/plugin marketplace add vulnify/vulnify-mcp
/plugin install vulnify@vulnify-mcp
```

From a shell:

```bash
claude plugin marketplace add vulnify/vulnify-mcp
claude plugin install vulnify@vulnify-mcp
```

Claude Code asks for the API key when the plugin is enabled, then starts Sign in with Vulnify for the MCP server. Run `/hooks` to confirm the hook loaded.

To connect only the hosted server, without the hook:

```bash
claude mcp add --transport http vulnify https://mcp.vulnify.io/mcp
```

Do not pass an API key on that command.
