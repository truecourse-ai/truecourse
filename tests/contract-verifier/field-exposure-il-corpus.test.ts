/**
 * Field-exposure as a first-class member of the realistic IL corpus.
 *
 * Both `sample-js-project-il` and `sample-python-project-il` carry a customer
 * public-profile read path (`customers.profile.service.ts` /
 * `customers_profile.py`) that exposes the customer's loyalty tier on BOTH
 * channels — an ORM read projection (`select` / `.values(...)`) and the API
 * response shape — plus an authored
 * `reference/contracts/customers/loyalty-tier-exposure.tc` field-exposure
 * artifact describing that obligation.
 *
 * This test proves the loop closes cross-language: the deterministic code
 * extractor derives the SAME exposure (field + channel set) the authored `.tc`
 * declares, with no language-specific special-casing in the contract surface —
 * only the natural snake_case-vs-camelCase column spelling differs.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { parseTcFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import { extractFieldExposuresFromDir } from '../../packages/contract-verifier/src/extractor/field-exposure/index.js';
import { extractFieldExposuresFromFile } from '../../packages/contract-verifier/src/extractor/field-exposure/ts-fields.js';
import { extractPyFieldExposuresFromFile } from '../../packages/contract-verifier/src/extractor/field-exposure/py-fields.js';
import type { ExtractedFieldExposure } from '../../packages/contract-verifier/src/extractor/field-exposure/index.js';
import type { FieldExposureContract } from '../../packages/contract-verifier/src/types/index.js';

beforeAll(async () => {
  await initParsers();
});

interface Case {
  fixture: string;
  /** The field name the code exposes (camelCase in JS, snake_case in Python). */
  field: string;
  /** The profile-service file (relative to the fixture's code dir). */
  profileFile: string;
  lang: 'typescript' | 'python';
}

const CASES: Case[] = [
  {
    fixture: 'sample-js-project-il',
    field: 'loyaltyTier',
    profileFile: 'src/services/customers.profile.service.ts',
    lang: 'typescript',
  },
  {
    fixture: 'sample-python-project-il',
    field: 'loyalty_tier',
    profileFile: 'app/services/customers_profile.py',
    lang: 'python',
  },
];

/** Run the right per-language matcher over a single source file. */
function extractFromFile(filePath: string, lang: Case['lang']): ExtractedFieldExposure[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const tree = parseFile(filePath, source, lang);
  const recs =
    lang === 'python'
      ? extractPyFieldExposuresFromFile(filePath, source, tree)
      : extractFieldExposuresFromFile(filePath, source, tree);
  tree.delete();
  return recs;
}

function liftAuthored(tcPath: string): FieldExposureContract {
  const src = fs.readFileSync(tcPath, 'utf-8');
  const file = parseTcFile(tcPath, src);
  const r = resolve([file]);
  expect(r.errors, `resolver errors in ${tcPath}: ${r.errors.map((e) => e.message).join('; ')}`).toEqual([]);
  const art = r.index.values().next().value!;
  expect(art.ref.type).toBe('FieldExposure');
  return art.contract as FieldExposureContract;
}

for (const c of CASES) {
  describe(`FieldExposure — IL corpus (${c.fixture})`, () => {
    const root = path.resolve(__dirname, `../fixtures/${c.fixture}`);
    const tcPath = path.join(root, 'reference/contracts/customers/loyalty-tier-exposure.tc');
    const codeDir = path.join(root, 'code');

    it('the authored .tc resolves to a Customer.loyalty-tier exposure on both channels', () => {
      const authored = liftAuthored(tcPath);
      expect(authored.target.field).toBe(c.field);
      expect(authored.target.entity).toEqual({ type: 'Entity', identity: 'Customer', quoted: false });
      expect([...authored.exposedVia].sort()).toEqual(['api-response', 'query-select']);
    });

    it('the code extractor derives the SAME field + channel set from the read path', async () => {
      const recs = await extractFieldExposuresFromDir(codeDir);
      const code = recs.find((r) => r.contract.target.field === c.field);
      expect(code, `no code-side field-exposure for ${c.field}`).toBeDefined();
      // Both channels: included in the read projection AND in the response shape.
      expect([...code!.contract.exposedVia].sort()).toEqual(['api-response', 'query-select']);
    });

    it('the profile-service read path is itself an exposure site (both channels)', () => {
      // The dir dispatcher dedupes the field across files (the tier is read on
      // more than one path), so assert directly on the profile file: it is the
      // site the authored `.tc` names, and it exposes the tier via BOTH a read
      // projection and a response shape on its own.
      const recs = extractFromFile(path.join(codeDir, c.profileFile), c.lang);
      const channels = recs
        .filter((r) => r.contract.target.field === c.field)
        .flatMap((r) => r.contract.exposedVia);
      expect([...new Set(channels)].sort()).toEqual(['api-response', 'query-select']);
    });

    it('authored .tc and code-extracted contract agree on the code-derivable core', async () => {
      const authored = liftAuthored(tcPath);
      const recs = await extractFieldExposuresFromDir(codeDir);
      const code = recs.find((r) => r.contract.target.field === c.field)!;
      // The contract surface is general: the comparator matches a bare-field
      // code site against an entity-bound spec target by field name + channels.
      expect(code.contract.target.field).toBe(authored.target.field);
      expect([...code.contract.exposedVia].sort()).toEqual([...authored.exposedVia].sort());
    });

    it('staff-only internalNotes is never exposed (deselected / absent from the response)', async () => {
      const recs = await extractFieldExposuresFromDir(codeDir);
      expect(recs.some((r) => /internal[_]?notes/i.test(r.contract.target.field))).toBe(false);
    });
  });
}
