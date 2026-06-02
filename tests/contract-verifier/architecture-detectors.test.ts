import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initParsers } from '../../packages/analyzer/src/index.js';
import { buildCodebaseScan, getArchitectureDetector } from '../../packages/contract-verifier/src/extractor/architecture/index.js';

beforeAll(async () => {
  await initParsers();
});

function makeCodeDir(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-arch-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

async function detect(category: Parameters<typeof getArchitectureDetector>[0], files: Record<string, string>) {
  const dir = makeCodeDir(files);
  const scan = await buildCodebaseScan(dir);
  return getArchitectureDetector(category)!.detect(scan);
}

const pkg = (deps: Record<string, string>) => JSON.stringify({ name: 'x', dependencies: deps });

describe('architecture detectors', () => {
  it('data-store: detects postgres (pg + prisma provider) and mongodb (mongoose) together', async () => {
    const result = await detect('data-store', {
      'package.json': pkg({ pg: '^8.0.0', '@prisma/client': '^5.0.0', mongoose: '^7.0.0' }),
      'prisma/schema.prisma': 'datasource db {\n  provider = "postgresql"\n}\n',
    });
    expect(result.confidence).toBe('high');
    const values = result.observed.map((o) => o.value).sort();
    expect(values).toContain('postgres');
    expect(values).toContain('mongodb');
  });

  it('data-store: a prisma schema with provider=mysql is mysql, not postgres', async () => {
    const result = await detect('data-store', {
      'package.json': pkg({ mysql2: '^3.0.0' }),
      'prisma/schema.prisma': 'datasource db {\n  provider = "mysql"\n}\n',
    });
    const values = result.observed.map((o) => o.value);
    expect(values).toContain('mysql');
    expect(values).not.toContain('postgres');
  });

  it('messaging: no broker package ⇒ a determinate `none` observation, not inconclusive', async () => {
    const result = await detect('messaging', { 'package.json': pkg({ express: '^4.0.0' }) });
    expect(result.confidence).toBe('high');
    expect(result.observed).toEqual([{ value: 'none', signals: [] }]);
  });

  it('messaging: kafkajs ⇒ kafka observed', async () => {
    const result = await detect('messaging', { 'package.json': pkg({ kafkajs: '^2.0.0' }) });
    expect(result.observed.map((o) => o.value)).toContain('kafka');
  });

  it('communication-pattern: express ⇒ rest', async () => {
    const result = await detect('communication-pattern', {
      'package.json': pkg({ express: '^4.0.0' }),
      'src/app.ts': "import express from 'express';\nexport const app = express();\n",
    });
    expect(result.observed.map((o) => o.value)).toContain('rest');
  });

  it('build-system: no build config and no tsconfig ⇒ inconclusive', async () => {
    const result = await detect('build-system', { 'package.json': pkg({ express: '^4.0.0' }) });
    expect(result.confidence).toBe('inconclusive');
    expect(result.observed).toEqual([]);
  });

  it('build-system: a vite.config.ts ⇒ vite', async () => {
    const result = await detect('build-system', {
      'package.json': pkg({}),
      'vite.config.ts': 'export default {};\n',
    });
    expect(result.observed.map((o) => o.value)).toContain('vite');
  });

  it('imports alone (no dependency entry) still register as a signal', async () => {
    const result = await detect('data-store', {
      'package.json': pkg({}),
      'src/db.ts': "import { Pool } from 'pg';\nexport const pool = new Pool();\n",
    });
    expect(result.observed.map((o) => o.value)).toContain('postgres');
  });
});
