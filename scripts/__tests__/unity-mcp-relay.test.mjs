import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ASSISTANT_PACKAGE,
  ASSISTANT_TGZ_URL,
  ASSISTANT_VERSION,
  bundledRelayName,
  cursorMcpConfigPath,
  relayBaseDirectory,
  resolveRelayPath,
  unityMcpServerEntry,
} from '../unity-mcp/relay-paths.mjs';
import { mergeCursorMcpConfig } from '../unity-mcp/install-relay.mjs';

describe('Unity MCP relay paths', () => {
  it('pins the official Assistant package used by Unity MCP', () => {
    expect(ASSISTANT_PACKAGE).toBe('com.unity.ai.assistant');
    expect(ASSISTANT_VERSION).toBe('2.17.0-pre.1');
    expect(ASSISTANT_TGZ_URL).toBe(
      'https://download.packages.unity.com/com.unity.ai.assistant/-/com.unity.ai.assistant-2.17.0-pre.1.tgz',
    );
  });

  it('resolves the official ServerInstaller destinations', () => {
    expect(relayBaseDirectory('/home/dev')).toBe('/home/dev/.unity/relay');
    expect(resolveRelayPath({ home: '/home/dev', platform: 'linux', arch: 'x64' }))
      .toBe('/home/dev/.unity/relay/relay_linux');
    expect(resolveRelayPath({ home: 'C:\\Users\\dev', platform: 'win32', arch: 'x64' }))
      .toBe(path.join('C:\\Users\\dev', '.unity', 'relay', 'relay_win.exe'));
    expect(resolveRelayPath({ home: '/Users/dev', platform: 'darwin', arch: 'arm64' }))
      .toBe('/Users/dev/.unity/relay/relay_mac_arm64.app/Contents/MacOS/relay_mac_arm64');
    expect(resolveRelayPath({ home: '/Users/dev', platform: 'darwin', arch: 'x64' }))
      .toBe('/Users/dev/.unity/relay/relay_mac_x64.app/Contents/MacOS/relay_mac_x64');
  });

  it('names the bundled RelayApp~ binary for each platform', () => {
    expect(bundledRelayName({ platform: 'linux', arch: 'x64' })).toBe('relay_linux');
    expect(bundledRelayName({ platform: 'win32', arch: 'x64' })).toBe('relay_win.exe');
    expect(bundledRelayName({ platform: 'darwin', arch: 'arm64' })).toBe('relay_mac_arm64');
  });

  it('points Cursor at ~/.cursor/mcp.json like Unity DefaultIntegration', () => {
    expect(cursorMcpConfigPath('/home/dev')).toBe('/home/dev/.cursor/mcp.json');
    expect(unityMcpServerEntry('/home/dev/.unity/relay/relay_linux')).toEqual({
      command: '/home/dev/.unity/relay/relay_linux',
      args: ['--mcp'],
      env: {},
    });
  });

  it('merges unity-mcp into an existing Cursor mcp.json without dropping other servers', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'unity-mcp-config-'));
    const configPath = path.join(dir, 'mcp.json');
    writeFileSync(configPath, JSON.stringify({
      mcpServers: { resend: { url: 'https://example.test/mcp' } },
    }));
    mergeCursorMcpConfig(configPath, '/opt/relay_linux');
    const merged = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(merged.mcpServers.resend.url).toBe('https://example.test/mcp');
    expect(merged.mcpServers['unity-mcp']).toEqual({
      command: '/opt/relay_linux',
      args: ['--mcp'],
      env: {},
    });
  });
});
