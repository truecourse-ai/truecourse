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
    '--external:tree-sitter-python',
    '--external:pyright',
    '--external:embedded-postgres',
    '--external:postgres',
    // drizzle-kit is dev only
    '--external:drizzle-kit',
    '--banner:js="import { createRequire } from \'node:module\'; import { fileURLToPath as __esm_fileURLToPath } from \'node:url\'; import { dirname as __esm_dirname } from \'node:path\'; const require = createRequire(import.meta.url); const __filename = __esm_fileURLToPath(import.meta.url); const __dirname = __esm_dirname(__filename);"',
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
    '--external:tree-sitter',
    '--external:tree-sitter-typescript',
    '--external:tree-sitter-javascript',
    '--external:tree-sitter-python',
    '--external:pyright',
    '--external:embedded-postgres',
    '--external:postgres',
    '--banner:js="import { createRequire } from \'node:module\'; const require = createRequire(import.meta.url);"',
  ].join(' '),
);

// Ensure CLI is executable
fs.chmodSync(path.join(DIST, 'cli.mjs'), 0o755);

// 6b. Copy Claude Code skills
console.log('Copying skills...');
const skillsSrc = path.join(ROOT, 'tools/cli/skills');
const skillsDest = path.join(DIST, 'skills');
copyDir(skillsSrc, skillsDest);

// 7. Copy README and README assets used by npm package page rendering
console.log('Copying README and assets...');
fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(DIST, 'README.md'));
copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));

// 8. Generate package.json for npm publish
console.log('\nGenerating package.json...');
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const analyzerPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/analyzer/package.json'), 'utf-8'));
const serverPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/server/package.json'), 'utf-8'));
const cliPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/cli/package.json'), 'utf-8'));
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
    // Native modules — versions from packages/analyzer/package.json
    'tree-sitter': analyzerPkg.dependencies['tree-sitter'],
    'tree-sitter-typescript': analyzerPkg.dependencies['tree-sitter-typescript'],
    'tree-sitter-javascript': analyzerPkg.dependencies['tree-sitter-javascript'],
    'tree-sitter-python': analyzerPkg.dependencies['tree-sitter-python'],
    'pyright': analyzerPkg.dependencies['pyright'],
    // Runtime deps — versions from source package.json files
    'embedded-postgres': serverPkg.dependencies['embedded-postgres'],
    'dotenv': serverPkg.dependencies['dotenv'],
    'postgres': serverPkg.dependencies['postgres'],
    'commander': cliPkg.dependencies['commander'],
    '@clack/prompts': cliPkg.dependencies['@clack/prompts'],
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

// 9. Install production dependencies
console.log('\n=== Installing dependencies ===');
run('npm install --omit=dev --legacy-peer-deps', DIST);

console.log('\n=== Build complete ===');
console.log(`Output: ${DIST}`);
console.log('To publish: cd dist && npm publish');
