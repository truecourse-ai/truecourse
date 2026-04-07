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
