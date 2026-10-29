import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = new URL('..', import.meta.url);
const rootDir = fileURLToPath(root);

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, root), 'utf8')) as Record<string, unknown>;
}

describe('claude code plugin', () => {
  it('points the hosted MCP server at mcp.vulnify.io and asks for an API key only for the hook', () => {
    const plugin = readJson('plugins/vulnify/.claude-plugin/plugin.json');
    const mcp = readJson('plugins/vulnify/.mcp.json');
    const userConfig = plugin.userConfig as {
      vulnify_api_key: { sensitive: boolean; required: boolean; type: string };
    };

    assert.equal(plugin.name, 'vulnify');
    assert.equal(plugin.version, '0.1.0');
    assert.equal(plugin.license, 'MIT');
    assert.equal(plugin.homepage, 'https://docs.vulnify.io/mcp/');
    assert.equal(plugin.repository, 'https://github.com/vulnify/vulnify-mcp');
    assert.equal((plugin.author as { email: string }).email, 'contact@vulnify.io');
    assert.equal(userConfig.vulnify_api_key.type, 'string');
    assert.equal(userConfig.vulnify_api_key.sensitive, true);
    assert.equal(userConfig.vulnify_api_key.required, true);
    assert.equal(plugin.mcpServers, undefined);
    assert.equal(plugin.hooks, undefined);
    assert.deepEqual(mcp, {
      mcpServers: {
        vulnify: { type: 'http', url: 'https://mcp.vulnify.io/mcp' },
      },
    });
  });

  it('lists the plugin from the repo marketplace', () => {
    const marketplace = readJson('.claude-plugin/marketplace.json');
    const plugins = marketplace.plugins as Array<{ name: string; source: string; version: string; category: string }>;
    assert.equal(marketplace.name, 'vulnify-mcp');
    assert.equal((marketplace.owner as { name: string }).name, 'Vulnify');
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0].name, 'vulnify');
    assert.equal(plugins[0].source, './plugins/vulnify');
    assert.equal(plugins[0].version, '0.1.0');
    assert.equal(plugins[0].category, 'security');
  });

  it('runs the vendored PreToolUse hook before risky tools', () => {
    const hooks = readJson('plugins/vulnify/hooks/hooks.json');
    const pre = (hooks.hooks as { PreToolUse: Array<{ matcher: string; hooks: Array<Record<string, unknown>> }> }).PreToolUse;
    assert.equal(pre.length, 1);
    assert.equal(pre[0].matcher, 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch|mcp__.*');
    assert.deepEqual(pre[0].hooks[0], {
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/hooks/vulnify-hook.mjs'],
      timeout: 30,
      onFailure: 'block',
    });
  });

  it('keeps the plugin skills aligned with the repo skills', () => {
    for (const name of ['vulnify-guard-actions', 'vulnify-policies-as-code']) {
      const repo = readFileSync(new URL(`skills/${name}/SKILL.md`, root), 'utf8');
      const plugin = readFileSync(new URL(`plugins/vulnify/skills/${name}/SKILL.md`, root), 'utf8');
      assert.equal(plugin, repo);
    }
  });

  it('skips Vulnify tools, fail-closes without a key, and honors BLOCK', () => {
    const script = `
      import { config, decide, describe } from './plugins/vulnify/hooks/vulnify-hook.mjs';
      const key = 'vln_test_plugin_option';
      const cfg = config({ CLAUDE_PLUGIN_OPTION_VULNIFY_API_KEY: key });
      if (cfg.apiKey !== key) throw new Error('plugin option was not used');
      if (config({ VULNIFY_API_KEY: key }).apiKey !== key) throw new Error('env key was not used');
      const skipped = [
        ['mcp__plugin_vulnify_vulnify__decide_action', {}],
        ['mcp__vulnify__check_action', {}],
        ['Read', { file_path: 'README.md' }],
      ];
      for (const [tool_name, tool_input] of skipped) {
        if (describe({ tool_name, tool_input }, cfg) !== null) throw new Error('expected skip for ' + tool_name);
      }
      const rm = describe({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' } }, cfg);
      if (!rm || rm.action !== 'DELETE_DATA') throw new Error('rm was not DELETE_DATA');
      const held = await decide(
        { tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' } },
        { cfg: config({}), fetchImpl: async () => { throw new Error('fetch without a key'); } },
      );
      if (held?.hookSpecificOutput?.permissionDecision !== 'deny') throw new Error('missing key did not deny');
      if (!String(held.hookSpecificOutput.permissionDecisionReason).includes('no Vulnify API key')) {
        throw new Error('missing-key reason was ' + held.hookSpecificOutput.permissionDecisionReason);
      }
      let called = null;
      const blocked = await decide(
        { tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' }, tool_use_id: 'tu_1' },
        {
          cfg,
          fetchImpl: async (url, init) => {
            called = { url, authorization: init.headers.Authorization, idem: init.headers['Idempotency-Key'] };
            return new Response(JSON.stringify({ id: 'evt_1', finalDecision: 'BLOCK', reasons: ['policy'] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          },
        },
      );
      if (called?.url !== 'https://api.vulnify.io/v1/events') throw new Error('url ' + called?.url);
      if (called.authorization !== 'Bearer ' + key) throw new Error('auth header missing');
      if (called.idem !== 'cc-tu_1') throw new Error('idempotency ' + called.idem);
      if (blocked?.hookSpecificOutput?.permissionDecision !== 'deny') throw new Error('BLOCK did not deny');
      if (!String(blocked.hookSpecificOutput.permissionDecisionReason).includes('BLOCK')) throw new Error('BLOCK reason missing');
      const allowed = await decide(
        { tool_name: 'Write', tool_input: { file_path: 'notes.txt', content: 'hi' } },
        {
          cfg,
          fetchImpl: async () => new Response(JSON.stringify({ id: 'evt_2', finalDecision: 'ALLOW', reasons: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        },
      );
      if (allowed !== null) throw new Error('ALLOW defer should print nothing');
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
  });

  it('denies a risky command from stdin when no key is set', () => {
    const env = { ...process.env };
    delete env.VULNIFY_API_KEY;
    delete env.CLAUDE_PLUGIN_OPTION_VULNIFY_API_KEY;
    delete env.VULNIFY_HOOK_FAIL_OPEN;
    const run = spawnSync(process.execPath, ['plugins/vulnify/hooks/vulnify-hook.mjs'], {
      cwd: rootDir,
      encoding: 'utf8',
      env,
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' } }),
    });
    assert.equal(run.status, 0, run.stderr);
    const body = JSON.parse(run.stdout) as {
      hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };
    };
    assert.equal(body.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(body.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(body.hookSpecificOutput.permissionDecisionReason, /no Vulnify API key/);
  });
});
