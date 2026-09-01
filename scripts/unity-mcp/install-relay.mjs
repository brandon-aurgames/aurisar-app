#!/usr/bin/env node
/**
 * Installs the official Unity MCP relay the same way Unity Editor's
 * ServerInstaller does: copy the platform binary from
 * com.unity.ai.assistant/RelayApp~ to ~/.unity/relay/, then write the
 * Cursor mcp.json entry Unity's DefaultIntegration would write.
 *
 *   npm run unity-mcp:install
 *   UNITY_MCP_PACKAGE_TGZ=/path/to/assistant.tgz npm run unity-mcp:install
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSISTANT_TGZ_URL,
  ASSISTANT_VERSION,
  bundledRelayName,
  cursorMcpConfigPath,
  relayBaseDirectory,
  resolveRelayPath,
  unityMcpServerEntry,
} from './relay-paths.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...opts });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function downloadTarball(dest) {
  const override = process.env.UNITY_MCP_PACKAGE_TGZ;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`UNITY_MCP_PACKAGE_TGZ not found: ${override}`);
    }
    return override;
  }
  console.log(`Downloading ${ASSISTANT_TGZ_URL}`);
  run('curl', ['-fsSL', '-o', dest, ASSISTANT_TGZ_URL]);
  return dest;
}

function extractRelayFiles(tgz, extractDir, binaryName) {
  mkdirSync(extractDir, { recursive: true });
  const members = [`package/RelayApp~/${binaryName}`, 'package/RelayApp~/relay.json'];
  run('tar', ['-xzf', tgz, '-C', extractDir, ...members]);
  const binary = path.join(extractDir, 'package', 'RelayApp~', binaryName);
  const meta = path.join(extractDir, 'package', 'RelayApp~', 'relay.json');
  if (!existsSync(binary)) {
    throw new Error(`Package ${ASSISTANT_VERSION} did not contain RelayApp~/${binaryName}`);
  }
  return { binary, meta: existsSync(meta) ? meta : null };
}

function installBinary({ binary, meta, platform, arch }) {
  const targetDir = relayBaseDirectory();
  mkdirSync(targetDir, { recursive: true });
  const dest = resolveRelayPath({ platform, arch });
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(binary, dest);
  if (platform !== 'win32') chmodSync(dest, 0o755);
  if (meta) copyFileSync(meta, path.join(targetDir, 'relay.json'));
  return dest;
}

export function mergeCursorMcpConfig(configPath, command) {
  let config = { mcpServers: {} };
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf8').trim();
    if (raw) config = JSON.parse(raw);
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      config.mcpServers = {};
    }
  }
  config.mcpServers['unity-mcp'] = unityMcpServerEntry(command);
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

function writeProjectMcpConfig() {
  const projectPath = path.join(ROOT, '.cursor', 'mcp.json');
  const config = {
    mcpServers: {
      'unity-mcp': {
        command: 'node',
        args: ['${workspaceFolder}/scripts/unity-mcp/launch-relay.mjs'],
      },
    },
  };
  mkdirSync(path.dirname(projectPath), { recursive: true });
  writeFileSync(projectPath, `${JSON.stringify(config, null, 2)}\n`);
  return projectPath;
}

function main() {
  const platform = process.platform;
  const arch = process.arch;
  const binaryName = bundledRelayName({ platform, arch });
  const workDir = path.join(tmpdir(), `unity-mcp-install-${process.pid}`);
  mkdirSync(workDir, { recursive: true });

  const tgz = downloadTarball(path.join(workDir, 'assistant.tgz'));
  const extracted = extractRelayFiles(tgz, workDir, binaryName);
  const dest = installBinary({ ...extracted, platform, arch });

  const version = run(dest, ['--version']);
  const versionOut = (version.stdout || '').trim();
  console.log(`Installed Unity MCP relay → ${dest}`);
  if (versionOut) console.log(versionOut);

  const cursorConfig = mergeCursorMcpConfig(cursorMcpConfigPath(), dest);
  const projectConfig = writeProjectMcpConfig();
  console.log(`Configured Cursor MCP → ${cursorConfig}`);
  console.log(`Configured project MCP → ${projectConfig}`);
  console.log(
    'Unity MCP tools become available after Unity 6 is running with com.unity.ai.assistant, and you Accept the pending Cursor connection in Edit > Project Settings > AI > Unity MCP Server.',
  );
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
