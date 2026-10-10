import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
const cli = readFileSync(new URL('../dist/cli.js', import.meta.url), 'utf8');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (pkg.name !== '@vulnify/mcp') fail(`unexpected package name ${pkg.name}`);
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fail(`package.json version is ${pkg.version}`);
if (pkg.mcpName !== 'io.vulnify/mcp') fail(`mcpName is ${pkg.mcpName}`);
if (server.name !== pkg.mcpName) fail('server.json name must match package.json mcpName');
if (server.version !== pkg.version) fail('server.json version must match package.json');
if (server.packages?.[0]?.identifier !== pkg.name) fail('server.json npm identifier mismatch');
if (server.packages?.[0]?.version !== pkg.version) fail('server.json npm version mismatch');
if (server.remotes?.[0]?.url !== 'https://mcp.vulnify.io/mcp') fail('remote URL mismatch');
if (!cli.startsWith('#!/usr/bin/env node')) fail('dist/cli.js is missing the node shebang');

console.log('package check ok');
