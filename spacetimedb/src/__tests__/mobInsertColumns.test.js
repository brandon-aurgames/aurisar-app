import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Guard for the `insertMobFromSpawn` bug: the SpacetimeDB TS runtime pinned
 * in spacetimedb/package.json (2.2.0) does NOT apply a table column's
 * `.default(...)` at insert time — it only exists for the SQL schema/CLI. An
 * insert that omits a defaulted column crashes at `writeU64(undefined)`
 * instead of silently getting the declared default. That only surfaces on an
 * EMPTY database (maincloud already has mob rows, so it never fires there),
 * which is exactly how it slipped through — see the M2-8 handoff.
 *
 * So "has a `.default()`" is not a safe reason to omit a column from an
 * insert; every declared `mob` column must be supplied explicitly, every
 * time. This test derives the expected column set straight from the `mob`
 * table definition in index.ts (not a hardcoded copy of it) and checks every
 * `ctx.db.mob.insert({...})` call site against it, so a column added to the
 * table later without a matching insert-site update fails loudly here
 * instead of only on a fresh/empty database.
 *
 * This is a source-text guard (like scripts/__tests__/dbContract.test.js),
 * not an executed-reducer test: index.ts imports `spacetimedb/server` at
 * module scope, and the workspace intentionally runs two different
 * spacetimedb versions (root `^2.9.0` vs. the exact-pinned `2.2.0` under
 * spacetimedb/), so importing the module for real here would exercise the
 * wrong runtime and prove nothing about the pinned one.
 *
 * Written in plain JS, not TS: `spacetime build`/`publish` runs a
 * project-wide `tsc` check over spacetimedb's own tsconfig
 * (`"include": ["src/**\/*"]`, no `allowJs`, no test exclude, no vitest/node
 * types available), so a `.ts` test file here using vitest/node APIs breaks
 * the actual module build. A `.js` file is outside that TS project's
 * matched file set (no `allowJs`) and is never imported by index.ts, so it
 * is invisible to `spacetime build` while vitest still runs it normally.
 */

const INDEX_PATH = fileURLToPath(new URL('../index.ts', import.meta.url));
const src = readFileSync(INDEX_PATH, 'utf8');

/** Extracts text from `openIdx` (the opening bracket itself) through its
 * matching closing bracket, using a simple depth counter. */
function extractBalanced(text, openIdx, openChar, closeChar) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === openChar) depth++;
    else if (text[i] === closeChar) {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  throw new Error(`unbalanced ${openChar}${closeChar} starting at index ${openIdx}`);
}

/** Top-level `key:` property names of an object-literal source text (one
 * `key: value,` per line, which is this file's consistent style). */
function topLevelKeys(objectLiteralText) {
  const keys = [];
  const re = /^\s*(\w+):\s/gm;
  let m;
  while ((m = re.exec(objectLiteralText))) keys.push(m[1]);
  return keys;
}

// ---- derive the declared `mob` column set from the table definition ----
const MOB_DECL = 'mob: table(';
const tableDeclIdx = src.indexOf(MOB_DECL);
if (tableDeclIdx === -1) {
  throw new Error("mob table definition not found — did `mob: table(...)` move or get renamed in index.ts?");
}
const tableCallOpenParen = tableDeclIdx + MOB_DECL.length - 1; // the '(' in "table("
const tableCallText = extractBalanced(src, tableCallOpenParen, '(', ')');
// table({ options }, { columns }) — the columns object is the second
// top-level `{...}` argument.
const optionsBraceIdx = tableCallText.indexOf('{');
const optionsObjText = extractBalanced(tableCallText, optionsBraceIdx, '{', '}');
const columnsBraceIdx = tableCallText.indexOf('{', optionsBraceIdx + optionsObjText.length);
const columnsObjText = extractBalanced(tableCallText, columnsBraceIdx, '{', '}');
const declaredColumns = topLevelKeys(columnsObjText);

// ---- find every ctx.db.mob.insert({...}) call site in the file ----
const INSERT_CALL = 'ctx.db.mob.insert(';
const insertSites = [];
let searchFrom = 0;
for (;;) {
  const idx = src.indexOf(INSERT_CALL, searchFrom);
  if (idx === -1) break;
  const parenIdx = idx + INSERT_CALL.length - 1; // the '(' after "insert"
  const callText = extractBalanced(src, parenIdx, '(', ')');
  const braceIdx = callText.indexOf('{');
  const objText = extractBalanced(callText, braceIdx, '{', '}');
  const lineNo = src.slice(0, idx).split('\n').length;
  insertSites.push({ lineNo, keys: topLevelKeys(objText) });
  searchFrom = idx + INSERT_CALL.length;
}

describe('mob table insert sites (M2-8 regression guard)', () => {
  it('the `mob` table declares a non-trivial column set (guard hasn\'t gone blind)', () => {
    expect(declaredColumns.length).toBeGreaterThanOrEqual(15);
    expect(declaredColumns).toContain('floorYM');
    expect(declaredColumns).toContain('spawnedAt');
    expect(declaredColumns).toContain('lastAoeAt');
    expect(declaredColumns).toContain('enraged');
  });

  it('found at least one ctx.db.mob.insert call site to check', () => {
    expect(insertSites.length).toBeGreaterThan(0);
  });

  it.each(insertSites.map((site) => [site.lineNo, site]))(
    'insert at index.ts line %i supplies every declared mob column',
    (_lineNo, site) => {
      const missing = declaredColumns.filter((c) => !site.keys.includes(c));
      expect(missing, `missing columns at index.ts:${site.lineNo}: ${missing.join(', ')}`).toEqual([]);

      const unknown = site.keys.filter((k) => !declaredColumns.includes(k));
      expect(unknown, `insert at index.ts:${site.lineNo} sets unknown column(s): ${unknown.join(', ')}`).toEqual([]);
    },
  );
});
