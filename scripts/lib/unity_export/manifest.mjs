import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const normalizeText = (bytes) => Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function jsonBytes(value) {
  const text = JSON.stringify(value, function (key, entry) {
    if (entry === null || (typeof entry === 'number' && !Number.isFinite(entry)) ||
        ['function', 'symbol', 'bigint'].includes(typeof entry) ||
        (entry === undefined && Array.isArray(this))) {
      throw new Error(`Non-serializable content at key ${key}: ${String(entry)}`);
    }
    return entry; // JSON omits optional object properties that are undefined.
  }, 2);
  if (text === undefined) throw new Error('Cannot export an undefined JSON document.');
  return normalizeText(Buffer.from(text + '\n'));
}

export function addManifest(files) {
  const hashes = Object.fromEntries([...files.keys()].filter((path) => path !== 'manifest.json').sort()
    .map((path) => [path, sha256(files.get(path))]));
  files.set('manifest.json', jsonBytes({ schemaVersion: 1, files: hashes }));
}

function readOutput(root, path) {
  const bytes = readFileSync(join(root, path));
  return path.endsWith('.r16') || path.endsWith('.bin') ? bytes : normalizeText(bytes);
}

/** Do not follow symlinks/junctions while comparing, overwriting, or pruning. */
function listFiles(root, directory = root) {
  if (!existsSync(directory)) return [];
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Export directory must not be a symlink.');
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const rel = relative(root, path).split(sep).join('/');
    if (entry.isSymbolicLink()) throw new Error(`Export contains a symlink: ${rel}`);
    if (entry.isDirectory()) paths.push(...listFiles(root, path));
    else paths.push(rel);
  }
  return paths.sort();
}

/** --no-terrain keeps the full pack, verifying existing hashes without baking. */
export function retainTerrain(root, paths) {
  listFiles(root);
  if (!existsSync(join(root, 'manifest.json'))) {
    throw new Error('--no-terrain requires an existing full export; run node scripts/export_unity_content.mjs first.');
  }
  const manifest = JSON.parse(readOutput(root, 'manifest.json'));
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported existing export manifest schemaVersion.');
  const files = new Map();
  const stale = [];
  for (const path of paths) {
    const bytes = existsSync(join(root, path)) ? readOutput(root, path) : undefined;
    if (!bytes || sha256(bytes) !== manifest.files?.[path]) stale.push(path);
    else files.set(path, bytes);
  }
  if (stale.length) {
    throw new Error(stale.map((path) => `STALE: export/unity-content/${path}`).join('\n') +
      '\nRun node scripts/export_unity_content.mjs to regenerate terrain.');
  }
  return files;
}

export function writeOrCheck(root, files, check) {
  const existing = listFiles(root);
  const expected = [...files.keys()].sort();
  // Verify all resolved destinations before the first mutation (including pruning).
  const rootPath = resolve(root);
  for (const path of [...expected, ...existing]) {
    const target = resolve(root, path);
    if (!target.startsWith(rootPath + sep)) throw new Error(`Export path escapes output directory: ${path}`);
  }
  let differences = 0;
  for (const path of expected) {
    const bytes = files.get(path);
    const target = join(root, path);
    const label = `export/unity-content/${path}`;
    console.log(`${label}  ${bytes.length} bytes  sha256:${sha256(bytes).slice(0, 12)}`);
    if (check) {
      if (!existsSync(target) || !readOutput(root, path).equals(bytes)) {
        console.error(`STALE: ${label}`);
        differences++;
      }
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
  }
  for (const path of existing) {
    if (files.has(path)) continue;
    if (check) {
      console.error(`ORPHAN: export/unity-content/${path}`);
      differences++;
    } else {
      unlinkSync(join(root, path));
      console.log(`PRUNED: export/unity-content/${path}`);
    }
  }
  return differences === 0;
}
