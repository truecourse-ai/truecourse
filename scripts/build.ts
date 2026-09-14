#!/usr/bin/env tsx

/**
 * Build script for TrueCourse npm package.
 *
 * 1. Build the workspace packages (tsc)
 * 2. Build dashboard client (vite → static export to apps/dashboard/client/dist/)
 * 3. Bundle dashboard server + CLI with esbuild
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

// require() resolver anchored at the source-facts package — NOT the repo root.
// The tree-sitter-* grammar packages are devDependencies of
// `packages/source-facts`; under pnpm's isolated layout they are NOT guaranteed
// to be reachable from the workspace root. Anchoring here matches where
// parser.ts runs at install time and ensures `.wasm` asset resolution works.
const requireFromSourceFacts = createRequire(
  path.join(ROOT, 'packages', 'source-facts', 'package.json'),
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

// 1. Build packages in dependency order. core's tsc imports the spec/guard
// packages, so their .d.ts files MUST exist before core compiles. The
// intra-package graph:
//
//   shared             ←  no truecourse deps
//   llm                ←  no truecourse deps
//   llm-api            ←  shared
//   source-facts       ←  shared
//   spec-consolidator  ←  shared + llm
//   guard-runner       ←  shared
//   interface-mapper   ←  shared + guard-runner
//   guard-generator    ←  guard-runner (+ shared)
//   core               ←  all of the above
console.log('\n=== Building packages ===');
run('pnpm --filter @truecourse/shared build');
run('pnpm --filter @truecourse/db build');
run('pnpm --filter @truecourse/llm build');
run('pnpm --filter @truecourse/agent-loop build');
run('pnpm --filter @truecourse/llm-api build');
run('pnpm --filter @truecourse/llm-claude-agent build');
run('pnpm --filter @truecourse/source-facts build');
run('pnpm --filter @truecourse/spec-consolidator build');
run('pnpm --filter @truecourse/guard-runner build');
run('pnpm --filter @truecourse/interface-mapper build');
run('pnpm --filter @truecourse/guard-generator build');
run('pnpm --filter @truecourse/core build');
run('pnpm --filter @truecourse/data-store build');
run('pnpm --filter @truecourse/jobs build');
run('pnpm --filter @truecourse/github-app build');

// 2. Build dashboard client (static export)
console.log('\n=== Building dashboard client (static export) ===');
run('pnpm --filter @truecourse/dashboard-client build');

// 3. Bundle dashboard server with esbuild. `web-tree-sitter` and `typescript`
// stay external so their package metadata (and asset files like the WASM
// runtime) can be resolved at runtime from installed node_modules.
console.log('\n=== Bundling dashboard server ===');
const cliPkgForVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tools/cli/package.json'), 'utf-8'),
);
const versionDefine = `--define:__TRUECOURSE_VERSION__=${JSON.stringify(JSON.stringify(cliPkgForVersion.version))}`;
run(
  [
    'npx esbuild apps/dashboard/server/src/index.ts',
    '--bundle',
    '--platform=node',
    '--target=node22',
    '--format=esm',
    '--outfile=dist/server.mjs',
    '--external:web-tree-sitter',
    '--external:typescript',
    // Keep the commercial enterprise plugin OUT of the community
    // artifact. The server reaches it only via a guarded dynamic
    // import, which resolves to nothing here → runs as community.
    '--external:@truecourse/ee-server',
    versionDefine,
    '--banner:js="import { createRequire } from \'node:module\'; const require = createRequire(import.meta.url);"',
  ].join(' '),
);

// 3b. Copy the drizzle migrations next to the bundle. The server runs them at
// boot; @truecourse/db is inlined into server.mjs, whose MIGRATIONS_DIR probe
// finds them at `<install>/drizzle` (see packages/db/src/db.ts).
console.log('\n=== Copying drizzle migrations ===');
copyDir(path.join(ROOT, 'packages/db/drizzle'), path.join(DIST, 'drizzle'));

// 4. Copy static frontend
console.log('\n=== Copying frontend to dist/public/ ===');
const webOut = path.join(ROOT, 'apps/dashboard/client/dist');
const distPublic = path.join(DIST, 'public');
copyDir(webOut, distPublic);

// 5. Build CLI entry
console.log('\n=== Bundling CLI ===');
run(
  [
    'npx esbuild tools/cli/src/index.ts',
    '--bundle',
    '--platform=node',
    '--target=node22',
    '--format=esm',
    '--outfile=dist/cli.mjs',
    '--external:node-windows',
    '--external:web-tree-sitter',
    '--external:typescript',
    // Community artifact excludes the commercial enterprise plugin.
    '--external:@truecourse/ee-server',
    versionDefine,
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
  'tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
];
for (const subpath of WASM_SUBPATHS) {
  const srcPath = requireFromSourceFacts.resolve(subpath);
  const destPath = path.join(wasmDest, path.basename(subpath));
  fs.copyFileSync(srcPath, destPath);
  console.log(`  ${subpath} → dist/wasm/${path.basename(subpath)}`);
}

// 7. Copy Claude Code skills
console.log('Copying skills...');
const skillsSrc = path.join(ROOT, 'tools/cli/skills');
const skillsDest = path.join(DIST, 'skills');
copyDir(skillsSrc, skillsDest);

// 7b. Copy bundled VS Code extension for `.tc` syntax highlighting.
// Installed silently into the user's editor extensions dir on first
// `truecourse analyze` — see `syncShippedTcSyntax` in commands/helpers.ts.
console.log('Copying VS Code extension...');
const tcExtSrc = path.join(ROOT, 'tools/cli/vscode-extension');
const tcExtDest = path.join(DIST, 'vscode-extension');
copyDir(tcExtSrc, tcExtDest);

// 8. Copy README and README assets used by npm package page rendering
console.log('Copying README and assets...');
fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(DIST, 'README.md'));
copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));

// 9. Generate package.json for npm publish
console.log('\nGenerating package.json...');
const sourceFactsPkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'packages/source-facts/package.json'), 'utf-8'),
);
const corePkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/package.json'), 'utf-8'));
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
    node: '>=22',
  },
  dependencies: {
    'dotenv': corePkg.dependencies['dotenv'],
    'commander': cliPkg.dependencies['commander'],
    '@clack/prompts': cliPkg.dependencies['@clack/prompts'],
    'typescript': sourceFactsPkg.dependencies['typescript'],
    'web-tree-sitter': sourceFactsPkg.dependencies['web-tree-sitter'],
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
