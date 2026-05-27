import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { verify } from '../../packages/contract-verifier/src/verify.js';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/sample-python-project-il');

/**
 * Parse `# IL-DRIFT: <drift-key>` markers from every Python file under
 * the fixture's code dir. Mirror of the JS/TS harness
 * (`verify-end-to-end.test.ts`) but for Python comment syntax. Each
 * marker is the exact drift key the verifier emits —
 * `<ArtifactType>:<identity> / <obligationKey>`.
 */
function parseIlDriftMarkers(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '__pycache__') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.py$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf-8');
      for (const line of source.split('\n')) {
        const match = line.match(/#\s*IL-DRIFT:\s*(.+)/);
        if (match) out.push(match[1].trim());
      }
    }
  };
  walk(rootDir);
  return out;
}

function driftKey(d: { artifactRef: { type: string; identity: string }; obligationKey: string }): string {
  return `${d.artifactRef.type}:${d.artifactRef.identity} / ${d.obligationKey}`;
}

describe('Contract verifier — end-to-end on the Python fixture', () => {
  it('runs without resolver errors', async () => {
    const result = await verify({
      contractsDir: path.join(FIXTURE_ROOT, 'reference/contracts'),
      codeDir: path.join(FIXTURE_ROOT, 'code'),
    });
    expect(result.resolverErrors).toEqual([]);
  });

  it('drift set matches the `# IL-DRIFT:` markers in fixture code (both directions)', async () => {
    const expected = new Set(parseIlDriftMarkers(path.join(FIXTURE_ROOT, 'code')));
    const result = await verify({
      contractsDir: path.join(FIXTURE_ROOT, 'reference/contracts'),
      codeDir: path.join(FIXTURE_ROOT, 'code'),
    });
    const actual = new Set(result.drifts.map(driftKey));

    const missing = [...expected].filter((k) => !actual.has(k)).sort();
    const unexpected = [...actual].filter((k) => !expected.has(k)).sort();

    expect(missing, `missing drifts (markers in fixture, but verifier didn't fire):\n  ${missing.join('\n  ')}`).toEqual([]);
    expect(unexpected, `unexpected drifts (verifier fired, but no marker):\n  ${unexpected.join('\n  ')}`).toEqual([]);
  });
});
