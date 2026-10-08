import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const moduleSrc = fileURLToPath(new URL('../', import.meta.url));

describe('module test convention (D187)', () => {
  it('keeps Vitest tests out of the module publish type-check by using .test.js', () => {
    // The module tsconfig includes all src/**/*.ts, but its separate install
    // intentionally has no Vitest dependency. Run these JS tests from the root.
    const typescriptTests = readdirSync(moduleSrc, { recursive: true })
      .filter((path) => path.endsWith('.test.ts'))
      .sort();

    expect(typescriptTests, 'Convert module .test.ts files to .test.js; do not add Vitest to the module package').toEqual([]);
  });
});
