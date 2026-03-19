#!/usr/bin/env tsx

/**
 * Build script for TrueCourse npm package.
 *
 * 1. Build shared + analyzer (tsc)
 * 2. Build web (next build → static export to apps/web/out/)
 * 3. Bundle server with esbuild (native deps external)
 * 4. Copy static frontend + migrations + CLI entry to dist/
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function run(cmd: string, cwd = ROOT) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Clean
console.log('Cleaning dist/...');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 1. Build shared + analyzer
console.log('\n=== Building packages ===');
run('pnpm --filter @truecourse/shared build');
run('pnpm --filter @truecourse/analyzer build');

// 2. Build web (static export)
console.log('\n=== Building frontend (static export) ===');
run('pnpm --filter @truecourse/web build');

// 3. Bundle server with esbuild
console.log('\n=== Bundling server ===');
run(
  [
    'npx esbuild apps/server/src/index.ts',
    '--bundle',
    '--platform=node',
    '--target=node20',
    '--format=esm',
    '--outfile=dist/server.mjs',
    // Only externalize native/binary deps that can't be bundled
    '--external:tree-sitter',
    '--external:tree-sitter-typescript',
    '--external:tree-sitter-javascript',
    '--external:embedded-postgres',
    '--external:postgres',
    // drizzle-kit is dev only
    '--external:drizzle-kit',
    '--banner:js="import { createRequire } from \'node:module\'; const require = createRequire(import.meta.url);"',
  ].join(' '),
);

// 4. Copy static frontend
console.log('\n=== Copying frontend to dist/public/ ===');
const webOut = path.join(ROOT, 'apps/web/dist');
const distPublic = path.join(DIST, 'public');
copyDir(webOut, distPublic);

// 5. Copy migrations
console.log('Copying migrations...');
const migrationsDir = path.join(ROOT, 'apps/server/src/db/migrations');
const distMigrations = path.join(DIST, 'db/migrations');
copyDir(migrationsDir, distMigrations);

// 6. Build CLI entry
console.log('\n=== Bundling CLI ===');
run(
  [
    'npx esbuild tools/cli/src/index.ts',
    '--bundle',
    '--platform=node',
    '--target=node20',
    '--format=esm',
    '--outfile=dist/cli.mjs',
    '--external:node-windows',
    '--banner:js="import { createRequire } from \'node:module\'; const require = createRequire(import.meta.url);"',
  ].join(' '),
);

// Ensure CLI is executable
fs.chmodSync(path.join(DIST, 'cli.mjs'), 0o755);

// 7. Generate package.json for npm publish
console.log('\nGenerating package.json...');
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const publishPkg = {
  name: 'truecourse',
  version: rootPkg.version || '0.1.0',
  description: 'Visualize your codebase architecture as an interactive graph',
  type: 'module',
  bin: {
    truecourse: './cli.mjs',
  },
  engines: {
    node: '>=20',
  },
  dependencies: {
    // Native modules that can't be bundled
    'tree-sitter': '^0.21.1',
    'tree-sitter-typescript': '^0.21.2',
    'tree-sitter-javascript': '^0.21.4',
    'embedded-postgres': '18.3.0-beta.16',
    // Runtime deps used by the server
    'dotenv': '^16.4.0',
    'postgres': '^3.4.0',
    'commander': '^12.1.0',
    '@clack/prompts': '^0.9.0',
  },
  optionalDependencies: {
    'node-windows': '^1.0.0-beta.8',
  },
  license: 'MIT',
  repository: {
    type: 'git',
    url: 'https://github.com/truecourse-ai/truecourse',
  },
  keywords: ['codebase', 'architecture', 'visualization', 'graph', 'tree-sitter'],
};
fs.writeFileSync(
  path.join(DIST, 'package.json'),
  JSON.stringify(publishPkg, null, 2) + '\n',
);

// 8. Install production dependencies
console.log('\n=== Installing dependencies ===');
run('npm install --production', DIST);

console.log('\n=== Build complete ===');
console.log(`Output: ${DIST}`);
console.log('To publish: cd dist && npm publish');
