/**
 * Official Unity MCP relay locations from com.unity.ai.assistant.
 * Matches MCPConstants.InstalledServerMainFile / ServerInstaller in
 * https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.17/manual/integration/unity-mcp-get-started.html
 */
import os from 'node:os';
import path from 'node:path';

export const ASSISTANT_PACKAGE = 'com.unity.ai.assistant';
export const ASSISTANT_VERSION = '2.17.0-pre.1';
export const ASSISTANT_TGZ_URL =
  `https://download.packages.unity.com/${ASSISTANT_PACKAGE}/-/${ASSISTANT_PACKAGE}-${ASSISTANT_VERSION}.tgz`;

export function relayBaseDirectory(home = os.homedir()) {
  return path.join(home, '.unity', 'relay');
}

export function bundledRelayName({ platform = process.platform, arch = process.arch } = {}) {
  if (platform === 'win32') return 'relay_win.exe';
  if (platform === 'darwin') return arch === 'arm64' ? 'relay_mac_arm64' : 'relay_mac_x64';
  return 'relay_linux';
}

/** Stable path MCP clients launch, after ServerInstaller copies the binary. */
export function resolveRelayPath({
  home = os.homedir(),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const base = relayBaseDirectory(home);
  const name = bundledRelayName({ platform, arch });
  if (platform === 'darwin') {
    return path.join(base, `${name}.app`, 'Contents', 'MacOS', name);
  }
  return path.join(base, name);
}

export function cursorMcpConfigPath(home = os.homedir()) {
  return path.join(home, '.cursor', 'mcp.json');
}

export function unityMcpServerEntry(command) {
  return {
    command,
    args: ['--mcp'],
    env: {},
  };
}
