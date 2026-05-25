import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initParsers } from '../../packages/analyzer/src/index.js';
import {
  detectForbiddenFiles,
  detectForbiddenEnvVar,
  detectForbiddenDependency,
  detectForbiddenFeatureFlag,
} from '../../packages/contract-verifier/src/extractor/forbidden/index.js';

beforeAll(async () => {
  await initParsers();
});

function mkRepo(layout: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-detect-'));
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

describe('Forbidden detectors', () => {
  describe('file-glob', () => {
    it('matches a literal path', () => {
      const root = mkRepo({
        'src/foo.ts': '',
        'src/bar.ts': '',
      });
      const matches = detectForbiddenFiles(root, 'src/foo.ts');
      expect(matches.map((m) => m.filePath.replace(root + '/', ''))).toEqual(['src/foo.ts']);
    });

    it('matches a ** pattern across path segments', () => {
      const root = mkRepo({
        'pipeline/signature_detection/st_downloader.py': '',
        'pipeline/other.py': '',
        'src/foo.py': '',
      });
      const matches = detectForbiddenFiles(root, 'pipeline/**/st_downloader.py');
      expect(matches.map((m) => m.filePath.replace(root + '/', ''))).toEqual([
        'pipeline/signature_detection/st_downloader.py',
      ]);
    });

    it('skips node_modules and .git', () => {
      const root = mkRepo({
        'node_modules/x/index.ts': '',
        '.git/HEAD': '',
        'src/found.ts': '',
      });
      const matches = detectForbiddenFiles(root, '**/*.ts');
      expect(matches.map((m) => m.filePath.replace(root + '/', ''))).toEqual(['src/found.ts']);
    });
  });

  describe('env-var', () => {
    it('finds process.env.NAME reads with line numbers', async () => {
      const root = mkRepo({
        'src/auth.ts': `
const bypass = process.env.AUTH_BYPASS;
if (bypass === 'true') skipAuth();
`,
      });
      const matches = await detectForbiddenEnvVar(root, 'AUTH_BYPASS');
      expect(matches).toHaveLength(1);
      expect(matches[0].lineStart).toBe(2);
    });

    it('does not match different env vars or unrelated property reads', async () => {
      const root = mkRepo({
        'src/x.ts': `
const x = process.env.AUTH_BYPASS_OTHER;
const y = somethingElse.AUTH_BYPASS;
`,
      });
      const matches = await detectForbiddenEnvVar(root, 'AUTH_BYPASS');
      expect(matches).toEqual([]);
    });

    it('finds Deno.env.get("NAME")', async () => {
      const root = mkRepo({
        'src/x.ts': `const x = Deno.env.get("MY_FLAG");`,
      });
      const matches = await detectForbiddenEnvVar(root, 'MY_FLAG');
      expect(matches).toHaveLength(1);
    });

    it('skips non-source files', async () => {
      const root = mkRepo({
        'README.md': 'process.env.AUTH_BYPASS in docs',
        'src/code.ts': 'const x = process.env.AUTH_BYPASS;',
      });
      const matches = await detectForbiddenEnvVar(root, 'AUTH_BYPASS');
      expect(matches.every((m) => m.filePath.endsWith('.ts'))).toBe(true);
    });
  });

  describe('dependency', () => {
    it('finds a package in dependencies', () => {
      const root = mkRepo({
        'package.json': JSON.stringify({ name: 'x', dependencies: { openai: '^4.0.0' } }),
      });
      const matches = detectForbiddenDependency(root, 'openai');
      expect(matches).toHaveLength(1);
      expect(matches[0].snippet).toContain('^4.0.0');
      expect(matches[0].snippet).toContain('dependencies');
    });

    it('finds in devDependencies / peerDependencies / optionalDependencies', () => {
      const root = mkRepo({
        'package.json': JSON.stringify({ name: 'x', devDependencies: { 'eslint-plugin-foo': '*' } }),
      });
      expect(detectForbiddenDependency(root, 'eslint-plugin-foo')).toHaveLength(1);
    });

    it('walks nested package.json (monorepo workspaces)', () => {
      const root = mkRepo({
        'package.json': JSON.stringify({ name: 'root' }),
        'packages/a/package.json': JSON.stringify({ name: 'a', dependencies: { lodash: '*' } }),
      });
      const matches = detectForbiddenDependency(root, 'lodash');
      expect(matches).toHaveLength(1);
    });

    it('returns no matches when dependency absent', () => {
      const root = mkRepo({
        'package.json': JSON.stringify({ name: 'x', dependencies: { other: '*' } }),
      });
      expect(detectForbiddenDependency(root, 'openai')).toEqual([]);
    });
  });

  describe('feature-flag', () => {
    it('finds an env-var-style feature flag', async () => {
      const root = mkRepo({
        'src/x.ts': 'const on = process.env.FEATURE_FOO_ENABLED === "true";',
      });
      const matches = await detectForbiddenFeatureFlag(root, 'FEATURE_FOO_ENABLED');
      expect(matches).toHaveLength(1);
    });

    it('falls back to scanning config files', async () => {
      const root = mkRepo({
        'config.json': '{ "features": { "FEATURE_FOO": true } }',
        // no env-var usage
      });
      const matches = await detectForbiddenFeatureFlag(root, 'FEATURE_FOO');
      expect(matches).toHaveLength(1);
      expect(matches[0].filePath.endsWith('config.json')).toBe(true);
    });
  });
});
