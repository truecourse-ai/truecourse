#!/usr/bin/env tsx

/**
 * Build script for TrueCourse npm package.
 *
 * 1. Build shared + analyzer (tsc)
 * 2. Build web (vite → static export to apps/web/dist/)
 * 3. Bundle server + CLI with esbuild
 * 4. Copy WASM assets (web-tree-sitter runtime + grammars) next to the bundle
 * 5. Generate publishable package.json + install production deps
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// require() resolver anchored at the analyzer package — NOT the repo root.
// The tree-sitter-* grammar packages are devDependencies of
// `packages/analyzer`; under pnpm's isolated layout they are NOT guaranteed
// to be reachable from the workspace root. Anchoring here matches where
// parser.ts runs at install time and ensures `.wasm` asset resolution works.
const requireFromAnalyzer = createRequire(
  path.join(ROOT, 'packages', 'analyzer', 'package.json'),
);

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

// 3. Bundle server with esbuild. `web-tree-sitter` and `pyright`/`typescript`
// stay external so their package metadata (and asset files like the WASM
// runtime) can be resolved at runtime from installed node_modules.
console.log('\n=== Bundling server ===');
run(
  [
    'npx esbuild apps/server/src/index.ts',
    '--bundle',
    '--platform=node',
    '--target=node20',
    '--format=esm',
    '--outfile=dist/server.mjs',
    '--external:web-tree-sitter',
    '--external:pyright',
    '--external:typescript',
    '--banner:js="import { createRequire } from \'node:module\'; const require = createRequire(import.meta.url);"',
  ].join(' '),
);

// 4. Copy static frontend
console.log('\n=== Copying frontend to dist/public/ ===');
const webOut = path.join(ROOT, 'apps/web/dist');
const distPublic = path.join(DIST, 'public');
copyDir(webOut, distPublic);

// 5. Build CLI entry
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
    '--external:web-tree-sitter',
    '--external:pyright',
    '--external:typescript',
    '--banner:js="import { createRequire as __cR } from \'node:module\'; const require = __cR(import.meta.url);"',
  ].join(' '),
);

// Ensure CLI is executable
fs.chmodSync(path.join(DIST, 'cli.mjs'), 0o755);

// 6. Copy tree-sitter WASM assets into dist/wasm/ so parser.ts finds them via
// BUNDLED_WASM_DIR at runtime. These are shipped alongside the bundle — no
// native compilation, no postinstall. Each subpath is resolvable via
// `require.resolve('<pkg>/<file>')` because web-tree-sitter exports its
// .wasm explicitly and the grammar packages have no `exports` restriction.
console.log('\n=== Copying tree-sitter WASM assets ===');
const wasmDest = path.join(DIST, 'wasm');
fs.mkdirSync(wasmDest, { recursive: true });
const WASM_SUBPATHS = [
  'web-tree-sitter/web-tree-sitter.wasm',
  'tree-sitter-typescript/tree-sitter-typescript.wasm',
  'tree-sitter-typescript/tree-sitter-tsx.wasm',
  'tree-sitter-javascript/tree-sitter-javascript.wasm',
  'tree-sitter-python/tree-sitter-python.wasm',
];
for (const subpath of WASM_SUBPATHS) {
  const srcPath = requireFromAnalyzer.resolve(subpath);
  const destPath = path.join(wasmDest, path.basename(subpath));
  fs.copyFileSync(srcPath, destPath);
  console.log(`  ${subpath} → dist/wasm/${path.basename(subpath)}`);
}

// 7. Copy Claude Code skills
console.log('Copying skills...');
const skillsSrc = path.join(ROOT, 'tools/cli/skills');
const skillsDest = path.join(DIST, 'skills');
copyDir(skillsSrc, skillsDest);

// 8. Copy README and README assets used by npm package page rendering
console.log('Copying README and assets...');
fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(DIST, 'README.md'));
copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));

// 9. Generate package.json for npm publish
console.log('\nGenerating package.json...');
const analyzerPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/analyzer/package.json'), 'utf-8'));
const serverPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/server/package.json'), 'utf-8'));
const cliPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/cli/package.json'), 'utf-8'));
const publishPkg = {
  name: 'truecourse',
  version: cliPkg.version || '0.1.0',
  description: 'Visualize your codebase architecture as an interactive graph',
  type: 'module',
  bin: {
    truecourse: './cli.mjs',
  },
  engines: {
    node: '>=20',
  },
  dependencies: {
    'pyright': analyzerPkg.dependencies['pyright'],
    'dotenv': serverPkg.dependencies['dotenv'],
    'commander': cliPkg.dependencies['commander'],
    '@clack/prompts': cliPkg.dependencies['@clack/prompts'],
    'typescript': analyzerPkg.dependencies['typescript'],
    'web-tree-sitter': analyzerPkg.dependencies['web-tree-sitter'],
  },
  optionalDependencies: {
    'node-windows': '^1.0.0-beta.8',
  },
  license: 'MIT',
  author: {
    name: 'Mushegh Gevorgyan',
    email: 'mushegh@truecourse.dev',
  },
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

// 10. Install production dependencies
console.log('\n=== Installing dependencies ===');
run('npm install --omit=dev --legacy-peer-deps', DIST);

console.log('\n=== Build complete ===');
console.log(`Output: ${DIST}`);
console.log('To publish: cd dist && npm publish');
