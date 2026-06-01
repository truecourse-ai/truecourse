import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initParsers } from '../../packages/analyzer/src/index.js';
import { extractOperationsFromDir } from '../../packages/contract-verifier/src/extractor/index.js';

/**
 * The verifier's code walkers must honor the repo-root `.truecourseignore`
 * so vendored / generated / fixture code under an ignored path is never
 * treated as an implementation to verify. `extractOperationsFromDir` is a
 * representative walker (the others share the same matcher wiring).
 */

let root: string;

beforeAll(async () => {
  await initParsers();
});

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

function place(rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

const route = (urlPath: string): string => `
  import express from 'express';
  const router = express.Router();
  router.get('${urlPath}', (req, res) => { res.status(200).json({}); });
`;

describe('verifier code walker — .truecourseignore', () => {
  it('skips operations defined under an ignored directory', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-vign-'));
    place('.truecourseignore', 'vendor/\n');
    place('src/orders.ts', route('/orders'));
    place('vendor/legacy.ts', route('/legacy'));

    const ids = (await extractOperationsFromDir(root)).map((o) => o.identity);
    expect(ids).toContain('GET /orders');
    expect(ids).not.toContain('GET /legacy');
  });

  it('walks every directory when no .truecourseignore is present', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-vign-'));
    place('src/orders.ts', route('/orders'));
    place('vendor/legacy.ts', route('/legacy'));

    const ids = (await extractOperationsFromDir(root)).map((o) => o.identity);
    expect(ids).toContain('GET /orders');
    expect(ids).toContain('GET /legacy');
  });
});
