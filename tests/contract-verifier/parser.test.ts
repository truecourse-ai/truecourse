import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from '../../packages/contract-verifier/src/parser/index.js';

const FIXTURE_IL = path.resolve(
  __dirname,
  '../fixtures/sample-js-project-il/reference/contracts',
);

function listTcFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && full.endsWith('.tc')) out.push(full);
    }
  };
  visit(root);
  return out.sort();
}

describe('Contract parser — fixture corpus', () => {
  const files = listTcFiles(FIXTURE_IL);

  it('discovers the expected set of .tc files', () => {
    expect(files.length).toBeGreaterThanOrEqual(22);
  });

  it.each(files.map((f) => [path.relative(FIXTURE_IL, f), f]))(
    'parses %s without error',
    (_relName, filePath) => {
      const source = fs.readFileSync(filePath, 'utf-8');
      const fileNode = parseFile(filePath, source);
      expect(fileNode.statements.length).toBeGreaterThan(0);

      // First top-level statement is the artifact declaration. Its head's
      // first token should be an identifier matching one of our artifact
      // keywords.
      const ARTIFACT_KEYWORDS = new Set([
        'operation',
        'entity',
        'enum',
        'state-machine',
        'auth-requirement',
        'authorization-rule',
        'error-envelope',
        'pagination-contract',
        'idempotency-contract',
        'effect-group',
        'unenforceable-obligation',
        'formula',
        'query-rule',
        'forbidden-artifact',
        'constant',
        'architecture-decision',
      ]);
      const first = fileNode.statements[0];
      expect(first.head.length).toBeGreaterThan(0);
      const head0 = first.head[0];
      expect(head0.kind).toBe('ident');
      if (head0.kind === 'ident') {
        expect(ARTIFACT_KEYWORDS.has(head0.value)).toBe(true);
      }

      // Every artifact has a body block.
      expect(first.block).toBeDefined();
      expect(first.block!.length).toBeGreaterThan(0);
    },
  );
});
