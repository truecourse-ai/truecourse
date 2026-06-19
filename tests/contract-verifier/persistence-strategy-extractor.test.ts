import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { extractPersistenceStrategiesFromDir } from '../../packages/contract-verifier/src/extractor/persistence-strategy/index.js';
import { extractPyMetadataKeysFromFile } from '../../packages/contract-verifier/src/extractor/persistence-strategy/py-metadata-keys.js';
import { extractCsMetadataKeysFromFile } from '../../packages/contract-verifier/src/extractor/persistence-strategy/cs-metadata-keys.js';
import type { ExtractedPersistenceStrategy } from '../../packages/contract-verifier/src/extractor/persistence-strategy/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, '../fixtures/persistence-strategy');

beforeAll(async () => {
  await initParsers();
});

function byField(rows: ExtractedPersistenceStrategy[]): Map<string, ExtractedPersistenceStrategy> {
  return new Map(rows.map((r) => [r.field, r]));
}

describe('persistence-strategy code extractor', () => {
  it('derives dedicated-column vs metadata-json from the realistic fixture', async () => {
    const rows = await extractPersistenceStrategiesFromDir(FIXTURE_DIR);
    const m = byField(rows);

    // A first-class schema column resolves to dedicated-column even though the
    // service ALSO reads it off the row (column wins, never double-emitted).
    const col = m.get('requiresCancellationReason');
    expect(col?.chosen).toBe('dedicated-column');
    expect(col?.source.filePath).toMatch(/schema\.prisma$/);

    // Settings that only ever appear as metadata-blob keys resolve to
    // metadata-json — covering member access (`metadata.disableGuests`) and
    // subscript access (`metadata["hideCalendarNotes"]`).
    expect(m.get('disableGuests')?.chosen).toBe('metadata-json');
    expect(m.get('hideCalendarNotes')?.chosen).toBe('metadata-json');

    // No metadata-json record is emitted for a name that is a real column.
    const colNamesAsMetadata = rows.filter(
      (r) => r.field === 'requiresCancellationReason' && r.chosen === 'metadata-json',
    );
    expect(colNamesAsMetadata).toHaveLength(0);
  });

  it('emits exactly one record per stored field (no duplicates across access sites)', async () => {
    const rows = await extractPersistenceStrategiesFromDir(FIXTURE_DIR);
    const fields = rows.map((r) => r.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it('produces a deterministic order: dedicated columns first, then metadata keys', async () => {
    const rows = await extractPersistenceStrategiesFromDir(FIXTURE_DIR);
    const firstMeta = rows.findIndex((r) => r.chosen === 'metadata-json');
    const lastColumn = rows.map((r) => r.chosen).lastIndexOf('dedicated-column');
    if (firstMeta >= 0 && lastColumn >= 0) {
      expect(lastColumn).toBeLessThan(firstMeta);
    }
  });
});

// ---------------------------------------------------------------------------
// Python: metadata-blob key detection across the access shapes the language
// uses. The blob-key scanner is the language-general counterpart to the TS
// one — the dispatcher reconciles its hits the same way for both languages.
// ---------------------------------------------------------------------------

function pyMetaKeys(source: string): string[] {
  const tree = parseFile('/test/x.py', source, 'python');
  const hits = extractPyMetadataKeysFromFile('/test/x.py', source, tree);
  tree.delete();
  return hits.map((h) => h.key).sort();
}

describe('persistence-strategy code extractor — Python metadata-blob keys', () => {
  it('detects keys across attribute, subscript, and dict .get(...) access', () => {
    expect(
      pyMetaKeys(`
def read(customer):
    metadata = customer.metadata or {}
    return {
        "a": metadata.marketing_opt_in,
        "b": metadata["beta_features"],
        "c": metadata.get("dark_mode"),
    }
`),
    ).toEqual(['beta_features', 'dark_mode', 'marketing_opt_in']);
  });

  it('reads keys off a member-chain blob (`row.metadata.KEY`)', () => {
    expect(pyMetaKeys(`x = row.metadata.feature_flag`)).toEqual(['feature_flag']);
  });

  it('never treats the `.get` method name itself as a stored key', () => {
    expect(pyMetaKeys(`v = metadata.get("opt_in")`)).toEqual(['opt_in']);
  });

  it('ignores accesses on a non-blob identifier', () => {
    expect(pyMetaKeys(`t = config.timeout`)).toEqual([]);
  });

  it('reconciles a Python metadata-only field to metadata-json via the dispatcher', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pstrat-py-'));
    try {
      fs.mkdirSync(path.join(dir, 'app'));
      fs.writeFileSync(
        path.join(dir, 'app', 'prefs.py'),
        [
          'def read(customer):',
          '    metadata = customer.metadata or {}',
          '    return bool(metadata.get("marketing_opt_in"))',
          '',
        ].join('\n'),
      );
      const rows = await extractPersistenceStrategiesFromDir(dir);
      // No schema source in this dir, so the field is seen only as a blob key.
      const m = new Map(rows.map((r) => [r.field, r]));
      expect(m.get('marketing_opt_in')?.chosen).toBe('metadata-json');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// C#: metadata-blob key hits in C# syntax — member access on a `Metadata`
// JObject/dynamic, and `Metadata["key"]` dictionary read/write. (The
// dedicated-column-vs-metadata-json reconciliation is language-agnostic and
// already covered by the dispatcher test above; here we assert the C# matcher
// surfaces the right keys.)
// ---------------------------------------------------------------------------

function csKeys(source: string): string[] {
  const tree = parseFile('/x.cs', source, 'csharp');
  const hits = extractCsMetadataKeysFromFile('/x.cs', source, tree);
  tree.delete();
  return hits.map((h) => h.key).sort();
}

describe('persistence-strategy code extractor — C#', () => {
  it('finds metadata keys via member access and indexer (read + write)', () => {
    const keys = csKeys(`
public class Repo {
  public void Save(Order o, string reason) {
    var a = o.Metadata.DisableGuests;
    var b = o.Metadata["hideCalendarNotes"];
    o.Metadata["refundPolicy"] = reason;
  }
}`);
    expect(keys).toEqual(['DisableGuests', 'hideCalendarNotes', 'refundPolicy']);
  });

  it('recognizes a bare `metadata` blob identifier', () => {
    const keys = csKeys(`public class R { public void M(string v) { metadata["cancellationReason"] = v; } }`);
    expect(keys).toEqual(['cancellationReason']);
  });

  it('does not treat a normal (non-blob) member/indexer access as metadata', () => {
    const keys = csKeys(`public class R { public void M(Config config, string[] items) { var x = config.Timeout; var y = items["0"]; } }`);
    expect(keys).toEqual([]);
  });

  it('reconciles C# metadata keys to metadata-json end-to-end (no schema column)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cspers-'));
    fs.writeFileSync(path.join(dir, 'repo.cs'), `public class R { public void M(Order o) { var a = o.Metadata["disableGuests"]; } }`);
    const rows = await extractPersistenceStrategiesFromDir(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    const m = byField(rows);
    expect(m.get('disableGuests')?.chosen).toBe('metadata-json');
  });
});
