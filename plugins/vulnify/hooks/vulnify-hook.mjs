#!/usr/bin/env node
/**
 * Vulnify PreToolUse hook for Claude Code.
 *
 * Reads the PreToolUse JSON from stdin, maps the tool call to a Vulnify event,
 * calls POST /v1/events, and prints a Claude Code hook decision:
 *   ALLOW  -> no decision (Claude Code's normal permission flow), or "allow" with VULNIFY_HOOK_ALLOW_MODE=allow
 *   REVIEW -> deny: waiting for approval in Vulnify (optionally waits VULNIFY_HOOK_REVIEW_WAIT_MS)
 *   BLOCK  -> deny with the reasons
 * Errors fail closed (deny) unless VULNIFY_HOOK_FAIL_OPEN=true.
 * No dependencies. Node 18+.
 *
 * Vendored from @vulnify/cli 0.3.0 for the Claude Code plugin.
 * The API key is the plugin option vulnify_api_key
 * (CLAUDE_PLUGIN_OPTION_VULNIFY_API_KEY), then VULNIFY_API_KEY.
 * Plugin MCP tools are named mcp__plugin_vulnify_vulnify__* and are skipped.
 */

const DEFAULT_SKIP = [
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'Task', 'Agent', 'WebSearch',
  'BashOutput', 'KillShell', 'KillBash', 'ExitPlanMode', 'AskUserQuestion', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
];

// Bash commands that only read. A command is skipped only when every part of it is in this list.
const SAFE_BASH = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'egrep', 'fgrep', 'find', 'fd', 'pwd', 'echo', 'printf',
  'wc', 'sort', 'uniq', 'cut', 'tr', 'diff', 'stat', 'file', 'which', 'whoami', 'date', 'env', 'printenv', 'tree',
  'du', 'df', 'true', 'false', 'test', 'cd', 'jq', 'basename', 'dirname', 'realpath', 'type', 'uname', 'sleep',
]);
const SAFE_GIT = new Set(['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'blame', 'remote', 'fetch', 'grep', 'describe', 'tag']);
const SAFE_NPM = new Set(['test', 'run', 'ls', 'view', 'outdated', 'audit']);

function envList(name, env = process.env) {
  return (env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function config(env = process.env) {
  const skip = new Set([...(env.VULNIFY_HOOK_SKIP_DEFAULTS === 'false' ? [] : DEFAULT_SKIP), ...envList('VULNIFY_HOOK_SKIP', env)]);
  return {
    apiKey: env.CLAUDE_PLUGIN_OPTION_VULNIFY_API_KEY || env.VULNIFY_API_KEY || '',
    baseUrl: (env.VULNIFY_BASE_URL || 'https://api.vulnify.io').replace(/\/+$/, ''),
    agent: env.VULNIFY_AGENT || 'claude-code',
    skip,
    checkReads: env.VULNIFY_HOOK_CHECK_READS === 'true',
    failOpen: env.VULNIFY_HOOK_FAIL_OPEN === 'true',
    allowMode: env.VULNIFY_HOOK_ALLOW_MODE === 'allow' ? 'allow' : 'defer',
    timeoutMs: Number(env.VULNIFY_HOOK_TIMEOUT_MS) || 8000,
    reviewWaitMs: Math.min(Number(env.VULNIFY_HOOK_REVIEW_WAIT_MS) || 0, 120000),
    sendContent: ['never', 'risky', 'always'].includes(env.VULNIFY_HOOK_SEND_CONTENT) ? env.VULNIFY_HOOK_SEND_CONTENT : 'risky',
  };
}

const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);

function bashParts(command) {
  return command.split(/&&|\|\||[;|\n]/).map((p) => p.trim().replace(/^(\w+=\S*\s+)+/, '')).filter(Boolean);
}

const MAX_RECORDS = 1_000_000;
const BIG = 10_000; // "the whole table": DELETE without WHERE, DROP, TRUNCATE
const FS_TREE = 5_000; // a recursive or wildcard filesystem delete: a whole directory tree

/** Files that grant an AI agent permissions, tools or MCP servers. */
export const AGENT_CONFIG_PATH = /(^|[\\/\s'"=])(\.claude[\\/](settings(\.local)?\.json|commands|agents|hooks)|claude_desktop_config\.json|\.mcp\.json|mcp\.json|\.cursor[\\/](mcp\.json|cli\.json|permissions\.json|rules)|\.vscode[\\/](mcp|settings)\.json|\.codex[\\/]config\.toml|\.gemini[\\/]settings\.json|\.codeium[\\/]windsurf[\\/]mcp_config\.json|\.continue[\\/]config\.(json|ya?ml)|\.aider\.conf\.yml)/i;

/** A recursive or wildcard filesystem delete (rm -rf, rm *, find -delete, find -exec rm, shred -r, git clean -fdx...). */
export function isTreeDelete(c) {
  for (const part of bashParts(c)) {
    const words = part.replace(/^((sudo|doas|nice|nohup|time|command|exec)\s+(-\S+\s+)*)+/, '').split(/\s+/);
    const cmd = words[0].replace(/^.*\//, '');
    const args = words.slice(1).filter((w) => w && !w.startsWith('-'));
    if (['rm', 'shred', 'unlink', 'rmdir', 'Remove-Item', 'del', 'rd'].includes(cmd)) {
      if (words.some((w) => /^-\w*[rR]/.test(w) || /^--recursive$/.test(w) || /^-Recurse$/i.test(w) || /^\/s$/i.test(w))) return true;
      if (args.some((a) => /[*?[]/.test(a) || a === '/' || a === '~' || a === '.' || a === '..')) return true;
    }
    if (cmd === 'find' && (words.includes('-delete') || /-exec(dir)?\s+(\S*\/)?(rm|shred|unlink)\b/.test(part))) return true;
    if (cmd === 'xargs' && /\b(rm|shred|unlink)\b/.test(part)) return true;
    if (cmd === 'git' && /^clean\b/.test(words.slice(1).join(' ')) && words.some((w) => /^-\w*f/.test(w))) return true;
  }
  return false;
}

/** A shell command that writes an agent permission/config file (redirect, tee, sed -i, cp/mv onto it, jq > ...). */
export function writesAgentConfig(c) {
  if (!AGENT_CONFIG_PATH.test(c)) return false;
  return /(>>?|\btee\b|\bsed\s+-i|\bperl\s+-pi|\b(cp|mv|install|ln)\b|\btouch\b|\bcat\s*<<|Set-Content|Out-File|Add-Content)/.test(c);
}
const num = (v) => {
  const n = Number(String(v).replace(/[_,]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_RECORDS) : 0;
};

const EMAIL_API = /\b(api\.sendgrid\.com|api\.mailgun\.net|api\.resend\.com|api\.postmarkapp\.com|api\.mailjet\.com|api\.brevo\.com|api\.sendinblue\.com|email(-smtp)?\.[a-z0-9-]+\.amazonaws\.com|mandrillapp\.com|api\.sparkpost\.com|smtp\.)/i;
const EMAIL_ADDR = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Rough number of records a shell command touches. 1 when nothing says otherwise. */
export function estimateBashRecords(c) {
  const counts = [];
  const sql = c.match(/\blimit\s+(\d+)/i);
  if (sql) counts.push(num(sql[1]));
  if (/\b(drop\s+(table|database|schema)|truncate(\s+table)?\s+\w)/i.test(c)) counts.push(BIG);
  const del = c.match(/\b(delete\s+from|update)\s+[\w."]+([^;'"]*)/i);
  if (del && !/\bwhere\b/i.test(del[2] || '') && !sql) counts.push(BIG);
  for (const m of c.matchAll(/(?:--(?:limit|count|max-results|max-count|page-size|per-page|batch-size|records|rows|number)|(?:^|\s)-n)[=\s]+(\d[\d_,]*)/gi)) counts.push(num(m[1]));
  if (isTreeDelete(c)) counts.push(FS_TREE);
  for (const m of c.matchAll(/\bseq\s+(?:\d+\s+)?(\d+)/g)) counts.push(num(m[1]));
  for (const m of c.matchAll(/\{\d+\.\.(\d+)\}/g)) counts.push(num(m[1]));
  for (const part of bashParts(c)) {
    const words = part.split(/\s+/);
    const cmd = words[0];
    const args = words.slice(1).filter((w) => w && !w.startsWith('-'));
    if (['rm', 'shred', 'unlink', 'rmdir'].includes(cmd)) {
      const recursive = words.some((w) => /^-\w*[rR]/.test(w) || w === '--recursive');
      const glob = args.some((a) => /[*?[]/.test(a));
      counts.push(Math.max(args.length, recursive || glob ? FS_TREE : 0));
    }
    if (['scp', 'rsync', 'sftp'].includes(cmd) && args.length > 1) {
      const recursive = words.some((w) => /^-\w*[ra]/.test(w));
      counts.push(Math.max(args.length - 1, recursive ? 100 : 0));
    }
    if (['mail', 'mailx', 'mutt', 'sendmail', 'msmtp', 'ssmtp'].includes(cmd)) {
      const rcpts = args.filter((a) => /@/.test(a)).length;
      if (rcpts) counts.push(rcpts);
    }
  }
  const rcpt = (c.match(/--mail-rcpt\b/g) || []).length;
  if (rcpt) counts.push(rcpt);
  return Math.max(1, ...counts.filter(Boolean));
}

function isEmailCommand(c) {
  return /(^|[\s;&|(])(sendmail|mailx?|mutt|swaks|msmtp|ssmtp|mpack|mail\.py)(\s|$)/.test(c)
    || /\bsmtps?:\/\//i.test(c) || /--mail-(rcpt|from)\b/.test(c)
    || /\baws\s+sesv?2?\s+send-(raw-)?email\b/.test(c) || /\bsmtplib\b|\bnodemailer\b|\bnet\/smtp\b|Send-MailMessage/i.test(c)
    || (/\b(curl|wget|http|httpie|xh)\b/.test(c) && EMAIL_API.test(c));
}

function classifyBash(command) {
  const c = command;
  if (isTreeDelete(c) || /(^|[\s;&|(])(rm|rmdir|shred|unlink)\s/.test(c) || /\b(drop\s+(table|database|schema)|truncate\s+table|delete\s+from)\b/i.test(c)
    || /git\s+(push\s+.*(--force|-f\b)|reset\s+--hard|clean\s+-\w*f|branch\s+-D)/.test(c)
    || /\b(curl|http|httpie|xh)\b.*\s-X\s*DELETE\b/i.test(c) || /\baws\s+s3\s+(rm|rb)\b|\bgsutil\s+rm\b|\bkubectl\s+delete\b/.test(c)) {
    return { action: 'DELETE_DATA', destination: /\b(curl|http|httpie|xh|aws|gsutil|kubectl)\b/.test(c) && !/(^|[\s;&|(])rm\s/.test(c) ? 'EXTERNAL_API' : 'INTERNAL' };
  }
  if (writesAgentConfig(c)) return { action: 'WRITE_DATA', destination: 'INTERNAL' };
  if (isEmailCommand(c)) return { action: 'SEND_EMAIL', destination: 'EXTERNAL_EMAIL' };
  if (/\b(curl|wget|http|httpie|xh)\b.*(\s-X\s*(POST|PUT|PATCH)|\s(-d|--data\S*|-F|--form\S*|-T|--upload-file|--json|--post-file|--post-data|--body-file)\b|\s\S+=@)/i.test(c)
    || /\b(scp|rsync|sftp|ftp|lftp|nc|ncat|netcat|socat)\b/.test(c) || /git\s+push\b/.test(c) || /\b(npm|pnpm|yarn)\s+publish\b|\btwine\s+upload\b|\bdocker\s+push\b/.test(c)
    || /\b(aws\s+s3\s+(cp|sync|mv)|gsutil\s+(cp|rsync|mv)|rclone|azcopy|az\s+storage\s+blob\s+upload)\b/.test(c)
    || /\bgh\s+(release\s+upload|gist\s+create)\b/.test(c) || /hooks\.slack\.com|discord(app)?\.com\/api\/webhooks/.test(c)) {
    return { action: 'EXPORT_DATA', destination: 'EXTERNAL_API' };
  }
  const parts = bashParts(c);
  const readOnly = parts.length > 0 && parts.every((p) => {
    if (/[^>]>[^&]|^>|>>/.test(p)) return false; // redirect writes a file
    const [cmd, sub] = p.split(/\s+/);
    if (cmd === 'git') return SAFE_GIT.has(sub);
    if (cmd === 'npm' || cmd === 'pnpm' || cmd === 'yarn') return SAFE_NPM.has(sub);
    return SAFE_BASH.has(cmd);
  });
  if (readOnly) return { action: 'READ_DATA', destination: 'INTERNAL' };
  return { action: 'WRITE_DATA', destination: 'INTERNAL' };
}

const COUNT_KEYS = /^(limit|count|max_?results|max_?count|page_?size|per_?page|batch_?size|num_?records|records|rows|quantity|top|first|last|n)$/i;
const RCPT_KEYS = /^(to|cc|bcc|recipients?|emails?|addresses|attendees|invitees|members|users|user_?ids|channels?)$/i;
const ID_LIST_KEYS = /(ids|items|records|rows|messages|files|documents|contacts|entries|keys|objects)$/i;

/** Recipients with an email address in an MCP tool input (to/cc/bcc/recipients...). */
function mcpRecipients(ti) {
  let n = 0;
  for (const [k, v] of Object.entries(ti || {})) {
    if (!RCPT_KEYS.test(k)) continue;
    const text = Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(',') : typeof v === 'string' ? v : '';
    n += (text.match(EMAIL_ADDR) || []).length;
  }
  return n;
}

/** Rough number of records an MCP call touches: list lengths, limit/count fields, recipients. */
export function estimateMcpRecords(ti) {
  const counts = [];
  const walk = (v, key, depth) => {
    if (depth > 3 || v == null) return;
    if (Array.isArray(v)) {
      if (ID_LIST_KEYS.test(key) || RCPT_KEYS.test(key) || v.length > 1) counts.push(Math.min(v.length, MAX_RECORDS));
      for (const x of v.slice(0, 50)) walk(x, key, depth + 1);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
      return;
    }
    if (COUNT_KEYS.test(key) && (typeof v === 'number' || /^\d+$/.test(String(v)))) counts.push(num(v));
    if (typeof v === 'string' && /^(query|sql|statement)$/i.test(key)) counts.push(estimateBashRecords(v));
  };
  walk(ti, '', 0);
  counts.push(mcpRecipients(ti));
  return Math.max(1, ...counts.filter(Boolean));
}

function classifyMcp(toolName, ti = {}) {
  const [, server = 'mcp', ...rest] = toolName.split('__');
  const rawTool = rest.join('__');
  const tool = rawTool.toLowerCase();
  const words = rawTool.split(/[^A-Za-z0-9]+|(?=[A-Z])/).map((w) => w.toLowerCase());
  const has = (re) => words.some((w) => re.test(w));
  const mailish = /mail|gmail|outlook|smtp|sendgrid|resend|mailgun|postmark|ses\b|brevo|mailchimp/i.test(server) || /mail/.test(tool) || mcpRecipients(ti) > 0;
  const sqlish = typeof (ti.sql ?? ti.query) === 'string' ? String(ti.sql ?? ti.query) : '';
  let out;
  if (has(/^(delete|remove|drop|purge|destroy|trash|archive|revoke|cancel|truncate)/) || /\b(delete\s+from|drop\s+table|truncate)\b/i.test(sqlish)) out = { action: 'DELETE_DATA', destination: 'EXTERNAL_API' };
  else if (has(/^(send|reply|forward|post|message|notify|email|dm|chat|draft)/)) out = mailish ? { action: 'SEND_EMAIL', destination: 'EXTERNAL_EMAIL' } : { action: 'EXPORT_DATA', destination: 'EXTERNAL_API' };
  else if (has(/^(export|share|upload|publish|invite|transfer|pay|charge|refund|payout|deploy|sync|backup|dump)/)) out = mailish && has(/^(share|invite)/) ? { action: 'EXPORT_DATA', destination: 'EXTERNAL_EMAIL' } : { action: 'EXPORT_DATA', destination: 'EXTERNAL_API' };
  else if (has(/^(get|list|search|read|fetch|query|find|describe|lookup|view|show|check|count|retrieve|download)$/) && !/\b(insert|update|delete|drop|alter|create)\b/i.test(sqlish)) out = { action: 'READ_DATA', destination: 'EXTERNAL_API' };
  else out = { action: 'WRITE_DATA', destination: 'EXTERNAL_API' };
  return { ...out, resource: clip(`mcp:${server}`, 100) };
}

/** Map a PreToolUse input to a Vulnify event body, or null when the tool is skipped. */
export function describe(input, cfg = config()) {
  const name = String(input.tool_name || '');
  const ti = input.tool_input || {};
  if (!name || cfg.skip.has(name)) return null;
  if (/^mcp__(?:plugin_vulnify_vulnify|vulnify)__/.test(name)) return null; // Vulnify's own tools
  let ev;
  let content = '';
  if (name === 'Bash' || name === 'PowerShell') {
    const command = String(ti.command || '');
    ev = { ...classifyBash(command), resource: 'shell', records: estimateBashRecords(command) };
    const hints = [];
    if (isTreeDelete(command)) hints.push('recursive or wildcard filesystem delete');
    if (writesAgentConfig(command)) { hints.push('writes an agent permission/config file'); ev.agentConfig = true; }
    content = hints.length ? `# vulnify-hint: ${hints.join('; ')}\n${command}` : command;
  } else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) {
    const path = String(ti.file_path ?? ti.notebook_path ?? ti.path ?? '');
    ev = { action: 'WRITE_DATA', destination: 'INTERNAL', resource: 'local files', agentConfig: AGENT_CONFIG_PATH.test(path) };
    const edits = Array.isArray(ti.edits) ? ti.edits.map((e) => String(e?.new_string ?? '')).join('\n') : '';
    const body = String(ti.content ?? ti.new_string ?? ti.new_source ?? '') || edits;
    content = path ? `file_path: ${path}\n${body}` : body;
  } else if (name === 'WebFetch') {
    ev = { action: 'READ_DATA', destination: 'EXTERNAL_API', resource: 'web' };
    content = String(ti.url || '');
  } else if (name.startsWith('mcp__')) {
    ev = { ...classifyMcp(name, ti), records: estimateMcpRecords(ti) };
    content = JSON.stringify(ti);
  } else {
    ev = { action: 'WRITE_DATA', destination: 'INTERNAL', resource: clip(`tool:${name}`, 100) };
    content = JSON.stringify(ti);
  }
  if (ev.action === 'READ_DATA' && !cfg.checkReads && name !== 'WebFetch') return null;
  const body = { agent: cfg.agent, action: ev.action, resource: ev.resource, destination: ev.destination, recordsAffected: ev.records || 1 };
  // Agent config edits always carry path + content: the engine needs them to flag "Agent permission change".
  const risky = ['SEND_EMAIL', 'EXPORT_DATA', 'DELETE_DATA'].includes(ev.action) || name === 'WebFetch' || !!ev.agentConfig;
  if (content && (cfg.sendContent === 'always' || (cfg.sendContent === 'risky' && risky) || (cfg.sendContent !== 'never' && ev.agentConfig))) body.content = clip(content, 20000);
  return body;
}

function out(decision, reason, extra = {}) {
  const hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason };
  return { hookSpecificOutput, ...extra };
}

async function call(cfg, fetchImpl, method, path, body, idem) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const headers = { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'vulnify-claude-code-hook/0.2' };
    if (idem) headers['Idempotency-Key'] = idem;
    const res = await fetchImpl(cfg.baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}${json.message ? `: ${String(json.message).slice(0, 200)}` : ''}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

/** Decide one PreToolUse input. Returns the JSON to print, or null for "no decision". */
export async function decide(input, { cfg = config(), fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const body = describe(input, cfg);
  if (!body) return null;
  const degraded = (why) => cfg.failOpen
    ? { systemMessage: `Vulnify degraded (${why}); ${input.tool_name} ran without a check because VULNIFY_HOOK_FAIL_OPEN=true.` }
    : out('deny', `Vulnify could not check this action (${why}), so it was held (fail closed). Tell the user; do not try to work around it.`);
  if (!cfg.apiKey) return degraded('no Vulnify API key is set');
  let d;
  try {
    d = await call(cfg, fetchImpl, 'POST', '/v1/events', body, input.tool_use_id ? `cc-${input.tool_use_id}` : undefined);
    let final = d.finalDecision ?? d.decision;
    const deadline = Date.now() + cfg.reviewWaitMs;
    while (final === 'REVIEW' && d.id && Date.now() < deadline) {
      await sleep(Math.min(3000, Math.max(0, deadline - Date.now())));
      d = await call(cfg, fetchImpl, 'GET', `/v1/events/${encodeURIComponent(d.id)}`);
      final = d.finalDecision ?? d.decision;
    }
  } catch (e) {
    return degraded(e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200));
  }
  const final = d.finalDecision ?? d.decision;
  const reasons = Array.isArray(d.reasons) && d.reasons.length ? d.reasons.join('; ') : 'no reasons given';
  const tag = `${body.action}${body.destination ? ` -> ${body.destination}` : ''}`;
  if (final === 'ALLOW') return cfg.allowMode === 'allow' ? out('allow', `Vulnify ALLOW (${tag}, event ${d.id})`) : null;
  if (final === 'REVIEW') {
    return out('deny', `Vulnify REVIEW (${tag}, event ${d.id}): waiting for approval in Vulnify. Reasons: ${reasons}. Tell the user a person must approve it at app.vulnify.io/approvals, then retry after approval.`);
  }
  if (final === 'BLOCK') return out('deny', `Vulnify BLOCK (${tag}, event ${d.id}): ${reasons}. Do not retry or work around this; tell the user.`);
  return degraded(`unexpected decision ${String(final).slice(0, 40)}`);
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    const cfg = config();
    if (cfg.failOpen) return;
    process.stderr.write('Vulnify hook: could not parse PreToolUse input; holding the action (fail closed).\n');
    process.exit(2);
  }
  const result = await decide(input);
  if (result) process.stdout.write(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('vulnify-hook.mjs')) {
  main().catch((e) => {
    if (process.env.VULNIFY_HOOK_FAIL_OPEN === 'true') return;
    process.stderr.write(`Vulnify hook failed: ${String(e?.message || e).slice(0, 200)}. Holding the action (fail closed).\n`);
    process.exit(2);
  });
}
