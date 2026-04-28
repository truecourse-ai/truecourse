import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';

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
