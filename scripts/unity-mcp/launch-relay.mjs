#!/usr/bin/env node
/**
 * Launch the official Unity MCP relay in --mcp mode for Cursor.
 * Install the binary first with: npm run unity-mcp:install
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolveRelayPath } from './relay-paths.mjs';

const bin = resolveRelayPath();
if (!existsSync(bin)) {
  console.error(
    `Unity MCP relay not found at ${bin}.\n` +
      'Install it with: npm run unity-mcp:install\n' +
      'The official relay is copied from com.unity.ai.assistant to ~/.unity/relay/.',
  );
  process.exit(1);
}

const extra = process.argv.slice(2);
const args = extra.includes('--mcp') ? extra : ['--mcp', ...extra];
const child = spawn(bin, args, { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
