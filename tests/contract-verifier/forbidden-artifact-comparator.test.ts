import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initParsers } from '../../packages/analyzer/src/index.js';
import { compareForbiddenArtifact } from '../../packages/contract-verifier/src/comparator/forbidden-artifact.js';
import type { ArtifactRef } from '../../packages/contract-verifier/src/types/index.js';

beforeAll(async () => {
  await initParsers();
});

function mkRepo(layout: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-cmp-'));
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const REF: ArtifactRef = { type: 'ForbiddenArtifact', identity: 'test', quoted: false };

describe('ForbiddenArtifact comparator', () => {
  it('fires per matching file (file-glob)', async () => {
    const codeDir = mkRepo({
      'pipeline/signature_detection/st_downloader.py': '# st downloader',
    });
    const drifts = await compareForbiddenArtifact({
      ref: REF, origin: null,
      contract: { category: 'file-glob', pattern: 'pipeline/**/st_downloader.py', reason: 'V1 OOS' },
      codeDir,
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('forbidden.file-glob.pipeline/**/st_downloader.py.present');
    expect(drifts[0].severity).toBe('high');
    expect(drifts[0].message).toContain('V1 OOS');
  });

  it('emits no drift when no files match', async () => {
    const codeDir = mkRepo({ 'src/foo.ts': '' });
    const drifts = await compareForbiddenArtifact({
      ref: REF, origin: null,
      contract: { category: 'file-glob', pattern: 'pipeline/**/st_downloader.py', reason: '' },
      codeDir,
    });
    expect(drifts).toEqual([]);
  });

  it('escalates to critical for auth-bypass env-var pattern', async () => {
    const codeDir = mkRepo({
      'src/auth.ts': 'const ok = process.env.AUTH_BYPASS === "true";',
    });
    const drifts = await compareForbiddenArtifact({
      ref: REF, origin: null,
      contract: { category: 'env-var', pattern: 'AUTH_BYPASS', reason: 'no bypass' },
      codeDir,
    });
    expect(drifts[0].severity).toBe('critical');
    expect(drifts[0].obligationKey).toBe('forbidden.env-var.AUTH_BYPASS.present');
  });

  it('emits high (not critical) for non-bypass env-var', async () => {
    const codeDir = mkRepo({
      'src/x.ts': 'const x = process.env.FEATURE_SOMETHING;',
    });
    const drifts = await compareForbiddenArtifact({
      ref: REF, origin: null,
      contract: { category: 'env-var', pattern: 'FEATURE_SOMETHING', reason: '' },
      codeDir,
    });
    expect(drifts[0].severity).toBe('high');
  });

  it('fires for forbidden dependency', async () => {
    const codeDir = mkRepo({
      'package.json': JSON.stringify({ name: 'x', dependencies: { openai: '^4.0.0' } }),
    });
    const drifts = await compareForbiddenArtifact({
      ref: REF, origin: null,
      contract: { category: 'dependency', pattern: 'openai', reason: 'use anthropic' },
      codeDir,
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('forbidden.dependency.openai.present');
    expect(drifts[0].codeSide).toContain('openai');
  });

  it('fires per detected feature-flag config + env-var occurrence', async () => {
    const codeDir = mkRepo({
      'src/x.ts': 'const on = process.env.FEATURE_FOO_ENABLED;',
    });
    const drifts = await compareForbiddenArtifact({
      ref: REF, origin: null,
      contract: { category: 'feature-flag', pattern: 'FEATURE_FOO_ENABLED', reason: '' },
      codeDir,
    });
    expect(drifts).toHaveLength(1);
  });
});
