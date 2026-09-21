import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const baselinePath = path.join(repoRoot, 'docs', 'theme-token-baseline.json');
const args = new Set(process.argv.slice(2));

const sourceExtensions = new Set([
  '.css', '.html', '.js', '.jsx', '.json', '.mjs', '.svg', '.ts', '.tsx',
]);

function isThemeSource(file) {
  const extension = path.extname(file).toLowerCase();
  if (!sourceExtensions.has(extension)) return false;
  if (file.includes('/__tests__/') || /\.(?:spec|test)\.[^.]+$/i.test(file)) return false;
  if (file.startsWith('src/')) return true;
  if (file.startsWith('public/')) return true;
  return !file.includes('/') && extension === '.html';
}

const repositoryFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const sourceFiles = repositoryFiles.filter(isThemeSource).sort();
const themeFile = 'src/styles/theme.css';
const colorPattern = /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{4}\b|#[0-9a-f]{3}\b|\b(?:rgba?|hsla?|oklch)\([^()]*\)/gi;
const variableDefinitionPattern = /--[a-z0-9_-]+\s*:/gi;
const variableReferencePattern = /var\(\s*--[a-z0-9_-]+/gi;
const inlineStylePattern = /\bstyle\s*=\s*\{\{/g;
const fontDeclarationPattern = /(?:font-family\s*:|fontFamily\s*:)/g;
const prohibitedFontPattern = new RegExp(['cin', 'zel'].join(''), 'gi');
const legacyAccentNamePattern = /\b(?:gold|golden|gilded)\b/gi;

const valueCounts = new Map();
const fileColorCounts = [];
let rawColorOccurrences = 0;
let hardCodedColorOccurrences = 0;
let cssVariableDefinitions = 0;
let cssVariableReferences = 0;
let inlineStyleObjects = 0;
let fontDeclarations = 0;
let prohibitedFontReferences = 0;
let legacyAccentNameReferences = 0;

for (const file of sourceFiles) {
  const absolutePath = path.join(repoRoot, file);
  let source;
  try {
    source = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    continue;
  }

  const colors = source.match(colorPattern) ?? [];
  const normalizedColors = colors.map(value => value.toLowerCase().replace(/\s+/g, ' ').trim());
  for (const value of normalizedColors) {
    valueCounts.set(value, (valueCounts.get(value) ?? 0) + 1);
  }

  rawColorOccurrences += colors.length;
  if (file !== themeFile) hardCodedColorOccurrences += colors.length;
  cssVariableDefinitions += (source.match(variableDefinitionPattern) ?? []).length;
  cssVariableReferences += (source.match(variableReferencePattern) ?? []).length;
  inlineStyleObjects += (source.match(inlineStylePattern) ?? []).length;
  fontDeclarations += (source.match(fontDeclarationPattern) ?? []).length;
  prohibitedFontReferences += (source.match(prohibitedFontPattern) ?? []).length;
  legacyAccentNameReferences += (source.match(legacyAccentNamePattern) ?? []).length;

  if (colors.length > 0 && file !== themeFile) {
    fileColorCounts.push({ file, occurrences: colors.length });
  }
}

const sortedValues = [...valueCounts.entries()]
  .map(([value, occurrences]) => ({ value, occurrences }))
  .sort((a, b) => b.occurrences - a.occurrences || a.value.localeCompare(b.value));

fileColorCounts.sort((a, b) => b.occurrences - a.occurrences || a.file.localeCompare(b.file));

const baseline = {
  schemaVersion: 1,
  scope: {
    description: 'Tracked runtime source under src/ and public/, plus root HTML entries; test files are excluded.',
    sourceFiles: sourceFiles.length,
    themePrimitiveFile: themeFile,
  },
  summary: {
    rawColorOccurrences,
    hardCodedColorOccurrences,
    uniqueRawColorValues: valueCounts.size,
    cssVariableDefinitions,
    cssVariableReferences,
    inlineStyleObjects,
    fontDeclarations,
    prohibitedFontReferences,
    legacyAccentNameReferences,
  },
  mostFrequentRawColors: sortedValues.slice(0, 40),
  filesWithMostHardCodedColors: fileColorCounts.slice(0, 30),
};

const serialized = `${JSON.stringify(baseline, null, 2)}\n`;

if (args.has('--write')) {
  fs.writeFileSync(baselinePath, serialized);
  console.log(`Updated ${path.relative(repoRoot, baselinePath)}`);
} else if (args.has('--check')) {
  const current = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf8') : '';
  if (current !== serialized) {
    console.error('Theme token baseline is stale. Run `pnpm run theme:audit:update` and review the diff.');
    process.exitCode = 1;
  } else {
    console.log('Theme token baseline is current.');
  }
} else {
  process.stdout.write(serialized);
}
