import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sourceFile = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type PackageExport = {
  import: string;
};

const corePackageJson = JSON.parse(
  readFileSync(sourceFile('./packages/core/package.json'), 'utf-8')
) as { exports: Record<string, PackageExport> };

// Root tests import @truecourse/core through its public subpaths, but several
// exported names intentionally differ from their source filenames
// (for example, services/rules -> services/rules.service.ts). Derive these
// aliases from package exports so Vitest tests source without requiring dist/.
// This can become a simple wildcard alias if core adds source-level public
// entry shims, e.g. src/services/rules.ts re-exporting rules.service.ts, or if
// source filenames are renamed to match the package export subpaths.
const coreAliases = Object.entries(corePackageJson.exports).map(([subpath, target]) => {
  const publicSubpath = subpath.replace(/^\.\//, '');
  const sourcePath = target.import
    .replace(/^\.\/dist\//, './packages/core/src/')
    .replace(/\.js$/, '.ts');

  return {
    find: new RegExp(`^@truecourse/core/${escapeRegExp(publicSubpath)}$`),
    replacement: sourceFile(sourcePath),
  };
});

export default defineConfig({
  resolve: {
    alias: [
      ...coreAliases,
      {
        find: /^@truecourse\/analyzer$/,
        replacement: sourceFile('./packages/analyzer/src/index.ts'),
      },
      {
        find: /^@truecourse\/shared$/,
        replacement: sourceFile('./packages/shared/src/index.ts'),
      },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/fixtures/**'],
    testTimeout: 30000,
    setupFiles: ['./tests/setup.ts'],
  },
});
