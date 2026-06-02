/**
 * End-to-end inference against the IL fixtures. Each fixture plants real,
 * undocumented decisions in its `code/` tree (a package-manager lockfile, a
 * policy constant, a consistently-applied query predicate, an undocumented
 * endpoint, a code-only enum). The committed `reference/contracts/_inferred/`
 * tree is the reviewed golden output; this test re-runs `infer` and asserts
 * the rendered `.tc` set matches it exactly — so any engine change that drifts
 * the output is caught here.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { infer, renderDecision } from '../../packages/contract-verifier/src/infer/index.js';
import { verify } from '../../packages/contract-verifier/src/verify.js';

function readTcTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (d: string, rel: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) visit(full, r);
      else if (e.name.endsWith('.tc')) out.set(r, fs.readFileSync(full, 'utf-8'));
    }
  };
  if (fs.existsSync(dir)) visit(dir, '');
  return out;
}

const FIXTURES = ['sample-js-project-il', 'sample-python-project-il'] as const;

for (const fixture of FIXTURES) {
  describe(`infer — ${fixture}`, () => {
    const root = path.resolve(__dirname, `../fixtures/${fixture}`);
    const contractsDir = path.join(root, 'reference/contracts');
    const codeDir = path.join(root, 'code');

    it('rendered output matches the committed reference/_inferred corpus', async () => {
      const res = await infer({ contractsDir, codeDir });
      const got = new Map(
        res.decisions.map((d) => {
          const r = renderDecision(d);
          return [r.relPath, r.tcSource] as const;
        }),
      );
      const want = readTcTree(path.join(contractsDir, '_inferred'));

      expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
      for (const [rel, src] of want) {
        expect(got.get(rel), `mismatch in ${rel}`).toBe(src);
      }
    });

    it('infers every kind the fixture plants', async () => {
      const res = await infer({ contractsDir, codeDir });
      const kinds = new Set(res.decisions.map((d) => d.kind));
      // Both fixtures plant a code-only enum, a policy constant, an
      // undocumented endpoint, and an implicit query policy.
      expect(kinds).toContain('Enum');
      expect(kinds).toContain('NamedConstant');
      expect(kinds).toContain('Operation');
      expect(kinds).toContain('QueryRule');
      // Every decision carries an inferred-from code location + confidence.
      for (const d of res.decisions) {
        expect(d.codeLoc.path.length).toBeGreaterThan(0);
        expect(['high', 'medium', 'low']).toContain(d.confidence);
      }
    });

    it('verify ignores _inferred by default but can opt in', async () => {
      const base = await verify({ contractsDir, codeDir });
      const withInferred = await verify({ contractsDir, codeDir, includeInferred: true });
      expect(withInferred.artifactCount).toBeGreaterThan(base.artifactCount);
    });
  });
}
