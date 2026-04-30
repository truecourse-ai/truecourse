import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
}

const FIXTURE_PATH = new URL('../fixtures/sample-js-project-negative', import.meta.url).pathname;

describe('discoverFiles', () => {
  it('discovers .ts files in the fixture project', () => {
    const files = discoverFiles(FIXTURE_PATH);
    const tsFiles = files.filter((f) => f.endsWith('.ts'));
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  it('does not return .json, .md, .yml files', () => {
    const files = discoverFiles(FIXTURE_PATH);
    const nonSourceFiles = files.filter(
      (f) => f.endsWith('.json') || f.endsWith('.md') || f.endsWith('.yml') || f.endsWith('.yaml')
    );
    expect(nonSourceFiles.length).toBe(0);
  });

  it('returns absolute paths', () => {
    const files = discoverFiles(FIXTURE_PATH);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.startsWith('/')).toBe(true);
    }
  });
});

describe('discoverFiles with gitignore patterns', () => {
  let tempDir: string;

  afterAll(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('skips files matching .gitignore patterns (node_modules)', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'truecourse-discovery-'));

    // Create project structure
    const srcDir = join(tempDir, 'src');
    const nodeModulesDir = join(tempDir, 'node_modules', 'some-package');
    const distDir = join(tempDir, 'dist');

    mkdirSync(srcDir, { recursive: true });
    mkdirSync(nodeModulesDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });

    // Create .gitignore
    writeFileSync(join(tempDir, '.gitignore'), 'node_modules/\ndist/\n');

    // Create source files
    writeFileSync(join(srcDir, 'app.ts'), 'const x = 1;');
    writeFileSync(join(srcDir, 'utils.ts'), 'export const y = 2;');

    // Create files that should be ignored
    writeFileSync(join(nodeModulesDir, 'fake.ts'), 'const z = 3;');
    writeFileSync(join(distDir, 'bundle.js'), 'var a = 1;');

    const files = discoverFiles(tempDir);

    // Should include src files
    expect(files.some((f) => f.includes('app.ts'))).toBe(true);
    expect(files.some((f) => f.includes('utils.ts'))).toBe(true);

    // Should NOT include node_modules or dist files
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.includes('dist'))).toBe(false);
  });

  it('discovers .tsx, .js, .jsx files when present', () => {
    // Reuse temp dir from prior test or create new one
    const dir = mkdtempSync(join(tmpdir(), 'truecourse-ext-'));
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, 'component.tsx'), 'export default function App() { return null; }');
    writeFileSync(join(srcDir, 'legacy.js'), 'module.exports = {};');
    writeFileSync(join(srcDir, 'widget.jsx'), 'export default function Widget() { return null; }');

    const files = discoverFiles(dir);

    expect(files.some((f) => f.endsWith('.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('.js'))).toBe(true);
    expect(files.some((f) => f.endsWith('.jsx'))).toBe(true);

    // Cleanup
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips minified bundles by default (*.min.js / .min.cjs / .min.mjs)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'truecourse-min-'));
    const vendor = join(dir, 'vendor');
    mkdirSync(vendor, { recursive: true });

    writeFileSync(join(dir, 'app.js'), 'const x = 1;');
    writeFileSync(join(vendor, 'pdf.worker.min.js'), 'a.b=1');
    writeFileSync(join(vendor, 'lib.min.cjs'), 'a.b=1');
    writeFileSync(join(vendor, 'lib.min.mjs'), 'a.b=1');

    const files = discoverFiles(dir);

    expect(files.some((f) => f.endsWith('app.js'))).toBe(true);
    expect(files.some((f) => f.endsWith('.min.js'))).toBe(false);
    expect(files.some((f) => f.endsWith('.min.cjs'))).toBe(false);
    expect(files.some((f) => f.endsWith('.min.mjs'))).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('skips minified-shaped JS files even when the name does not contain .min', () => {
    // Vendored bundles that ship as `*.production.js`, `*.bundle.js`, or
    // unconventional names slip through the *.min.* glob but are obviously
    // minified by content. Detect them by sniffing line density: if the
    // file is sufficiently large and the first window has very few
    // newlines, treat it as a build artifact.
    const dir = mkdtempSync(join(tmpdir(), 'truecourse-mincontent-'));
    const vendor = join(dir, 'static', 'vendor');
    mkdirSync(vendor, { recursive: true });

    // Normal source file - many short lines.
    writeFileSync(
      join(dir, 'app.js'),
      Array.from({ length: 200 }, (_, i) => `const x${i} = ${i};`).join('\n'),
    );

    // Auth0-spa-js style: ~40KB with two extremely long lines (license
    // banner + minified IIFE). This must be excluded by the content sniff.
    const longLine = 'a'.repeat(40_000);
    writeFileSync(
      join(vendor, 'auth0-spa-js.production.js'),
      `/* Auth0 SDK v2.0 - Apache 2.0 */\n${longLine}`,
    );

    const files = discoverFiles(dir);

    expect(files.some((f) => f.endsWith('app.js'))).toBe(true);
    expect(files.some((f) => f.endsWith('auth0-spa-js.production.js'))).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('skips webpack-style *.bundle.js even when the bundle has many short lines', () => {
    // Webpack output keeps line breaks - line-density sniff alone misses it
    // - but the `.bundle.js` suffix is a universal build-artifact tell.
    const dir = mkdtempSync(join(tmpdir(), 'truecourse-bundle-'));
    const staticDir = join(dir, 'static');
    mkdirSync(staticDir, { recursive: true });

    writeFileSync(join(dir, 'app.js'), 'const a = 1;');

    // Webpack-shaped: many lines, each short, but it's still a bundle.
    const bundle = Array.from({ length: 500 }, (_, i) => `var v${i} = ${i};`).join('\n');
    writeFileSync(join(staticDir, 'tracking.bundle.js'), bundle);
    writeFileSync(join(staticDir, 'admin.production.js'), bundle);
    writeFileSync(join(staticDir, 'admin.development.js'), bundle);

    const files = discoverFiles(dir);

    expect(files.some((f) => f.endsWith('app.js'))).toBe(true);
    expect(files.some((f) => f.endsWith('.bundle.js'))).toBe(false);
    expect(files.some((f) => f.endsWith('.production.js'))).toBe(false);
    expect(files.some((f) => f.endsWith('.development.js'))).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('does not treat large hand-written source as minified', () => {
    // Guard against false negatives - a 200KB hand-written JS file with
    // normal line lengths should still be discovered. The heuristic must
    // key off line *density*, not raw size.
    const dir = mkdtempSync(join(tmpdir(), 'truecourse-largesrc-'));
    const big = Array.from({ length: 5_000 }, (_, i) => `function f${i}() { return ${i}; }`).join('\n');
    writeFileSync(join(dir, 'big.js'), big);

    const files = discoverFiles(dir);

    expect(files.some((f) => f.endsWith('big.js'))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe('.truecourseignore with parent .gitignore', () => {
  const tempDirs: string[] = [];
  let repoDir: string;

  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function setup(truecourseignore: string): void {
    const tempDir = mkdtempSync(join(tmpdir(), 'truecourse-anchored-'));
    tempDirs.push(tempDir);
    const parentDir = join(tempDir, 'parent');
    repoDir = join(parentDir, 'repo');

    // Parent .gitignore — its presence is what triggers the bug; content is
    // intentionally generic.
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(join(parentDir, '.gitignore'), 'node_modules/\n');

    // Repo layout.
    const srcDir = join(repoDir, 'src');
    const extensionsDir = join(repoDir, 'extensions');
    const scriptsDir = join(repoDir, 'scripts');
    const booksDir = join(repoDir, 'BOOKS');
    const nestedExt = join(repoDir, 'src', 'extensions');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(extensionsDir, { recursive: true });
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(booksDir, { recursive: true });
    mkdirSync(nestedExt, { recursive: true });

    writeFileSync(join(srcDir, 'app.ts'), 'export const x = 1;');
    writeFileSync(join(extensionsDir, 'plugin.ts'), 'export const p = 1;');
    writeFileSync(join(extensionsDir, 'keep.ts'), 'export const k = 1;');
    writeFileSync(join(scriptsDir, 'ingest-epub.js'), 'module.exports = {};');
    writeFileSync(join(scriptsDir, 'other.js'), 'module.exports = {};');
    writeFileSync(join(booksDir, 'reader.ts'), 'export const b = 1;');
    writeFileSync(join(repoDir, 'secret.txt'), 'shh');
    writeFileSync(join(nestedExt, 'inner.ts'), 'export const i = 1;');

    writeFileSync(join(repoDir, '.truecourseignore'), truecourseignore);
  }

  it('honors leading-slash anchored pattern in .truecourseignore', () => {
    setup('/extensions/\n');

    const files = discoverFiles(repoDir);

    // Top-level extensions/ is excluded (anchored).
    expect(files.some((f) => f === join(repoDir, 'extensions', 'plugin.ts'))).toBe(false);
    // src/ files unaffected.
    expect(files.some((f) => f === join(repoDir, 'src', 'app.ts'))).toBe(true);
    // Leading-slash anchors only the top level — nested src/extensions/ is NOT
    // matched.
    expect(files.some((f) => f === join(repoDir, 'src', 'extensions', 'inner.ts'))).toBe(true);
  });

  it('honors internal-slash anchored pattern in .truecourseignore', () => {
    setup('scripts/ingest-epub.js\n');

    const files = discoverFiles(repoDir);

    // Specific anchored file is excluded.
    expect(files.some((f) => f === join(repoDir, 'scripts', 'ingest-epub.js'))).toBe(false);
    // Sibling in same directory is preserved.
    expect(files.some((f) => f === join(repoDir, 'scripts', 'other.js'))).toBe(true);
  });

  it('preserves non-anchored patterns (trailing-slash and bare name)', () => {
    // BOOKS/ is non-anchored (trailing-slash only) so it must match at any
    // depth. plugin.ts is a bare-name match — non-anchored, matches anywhere.
    setup('BOOKS/\nplugin.ts\n');

    const files = discoverFiles(repoDir);

    // Trailing-slash pattern excludes BOOKS/ at top level.
    expect(files.some((f) => f === join(repoDir, 'BOOKS', 'reader.ts'))).toBe(false);
    // Bare-name pattern excludes plugin.ts wherever it appears.
    expect(files.some((f) => f.endsWith('plugin.ts'))).toBe(false);
    // Other source files still discovered.
    expect(files.some((f) => f === join(repoDir, 'src', 'app.ts'))).toBe(true);
    expect(files.some((f) => f === join(repoDir, 'extensions', 'keep.ts'))).toBe(true);
  });

  it('honors negation in .truecourseignore', () => {
    // Ignore specific anchored files, then re-include one. The directory
    // itself stays traversable because we use file-level patterns.
    setup('extensions/plugin.ts\nextensions/keep.ts\n!extensions/keep.ts\n');

    const files = discoverFiles(repoDir);

    // Anchored ignore still applies to plugin.ts.
    expect(files.some((f) => f === join(repoDir, 'extensions', 'plugin.ts'))).toBe(false);
    // Negation re-includes extensions/keep.ts after re-anchoring.
    expect(files.some((f) => f === join(repoDir, 'extensions', 'keep.ts'))).toBe(true);
  });
});

// These exercise gitignore semantics that the manual walker can't get right.
// They require an actual git repo so the implementation can delegate to
// `git ls-files --exclude-standard`.
describe('discoverFiles in a git repo (gitignore semantics)', () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'truecourse-gitrepo-'));
    tempDirs.push(dir);
    return dir;
  }

  it('honors anchored patterns in nested .gitignore files', () => {
    // A nested .gitignore at repo/sub/.gitignore with an internal-slash
    // pattern is anchored to repo/sub/, not the repo root. The single-matcher
    // walker conflates the two roots and silently misses anchored rules in
    // nested .gitignore files.
    const repo = makeRepo();
    gitInit(repo);

    mkdirSync(join(repo, 'sub', 'internal'), { recursive: true });
    mkdirSync(join(repo, 'internal'), { recursive: true });

    writeFileSync(join(repo, 'sub', '.gitignore'), 'internal/secret.ts\n');
    writeFileSync(join(repo, 'sub', 'internal', 'secret.ts'), 'export const s = 1;');
    writeFileSync(join(repo, 'sub', 'internal', 'public.ts'), 'export const p = 1;');
    // Decoy at the repo root — the nested rule must not anchor here.
    writeFileSync(join(repo, 'internal', 'secret.ts'), 'export const r = 1;');

    const files = discoverFiles(repo);

    // The nested rule should anchor to repo/sub/.
    expect(files.some((f) => f === join(repo, 'sub', 'internal', 'secret.ts'))).toBe(false);
    expect(files.some((f) => f === join(repo, 'sub', 'internal', 'public.ts'))).toBe(true);
    // Repo-root file is unrelated to the nested rule.
    expect(files.some((f) => f === join(repo, 'internal', 'secret.ts'))).toBe(true);
  });

  it('honors .git/info/exclude', () => {
    // git's per-repo non-shared excludes file. The walker never reads it.
    const repo = makeRepo();
    gitInit(repo);

    writeFileSync(join(repo, '.git', 'info', 'exclude'), 'private.ts\n');
    writeFileSync(join(repo, 'private.ts'), 'export const p = 1;');
    writeFileSync(join(repo, 'public.ts'), 'export const q = 1;');

    const files = discoverFiles(repo);

    expect(files.some((f) => f === join(repo, 'private.ts'))).toBe(false);
    expect(files.some((f) => f === join(repo, 'public.ts'))).toBe(true);
  });

  it('does not apply .gitignore from outside the git repo boundary', () => {
    // The walker climbs to the filesystem root collecting every ancestor
    // .gitignore. A .gitignore in a directory that is not part of the git
    // repo (e.g. ~/.gitignore) must not influence files inside the repo —
    // git itself ignores it.
    const tempDir = mkdtempSync(join(tmpdir(), 'truecourse-boundary-'));
    tempDirs.push(tempDir);

    const outside = join(tempDir, 'outside');
    mkdirSync(outside, { recursive: true });
    // This .gitignore lives outside any git repo; it must not leak in.
    writeFileSync(join(outside, '.gitignore'), 'should-be-included.ts\n');

    const repo = join(outside, 'repo');
    mkdirSync(repo, { recursive: true });
    gitInit(repo);

    writeFileSync(join(repo, 'should-be-included.ts'), 'export const x = 1;');

    const files = discoverFiles(repo);

    expect(files.some((f) => f === join(repo, 'should-be-included.ts'))).toBe(true);
  });
});
