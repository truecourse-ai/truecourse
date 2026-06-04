import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { verify } from '../../packages/contract-verifier/src/verify.js';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/sample-js-project-il');

/**
 * Parse `// IL-DRIFT: <drift-key>` markers from every TS/JS file under
 * the fixture's code dir. Each marker is the exact drift key the
 * verifier emits — `<ArtifactType>:<identity> / <obligationKey>`. The
 * fixture's `// IL-DRIFT:` annotations are the canonical bug catalog;
 * the test asserts the verifier's drift set matches them exactly.
 */
function parseIlDriftMarkers(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf-8');
      for (const line of source.split('\n')) {
        const match = line.match(/\/\/\s*IL-DRIFT:\s*(.+)/);
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

describe('Contract verifier — end-to-end on fixture (Operation slice only)', () => {
  it('runs without resolver errors', async () => {
    const result = await verify({
      contractsDir: path.join(FIXTURE_ROOT, 'reference/contracts'),
      codeDir: path.join(FIXTURE_ROOT, 'code'),
    });
    expect(result.resolverErrors).toEqual([]);
    expect(result.artifactCount).toBeGreaterThanOrEqual(20);
    expect(result.extractedOperationCount).toBeGreaterThan(0);
  });

  it('drift set matches the `// IL-DRIFT:` markers in fixture code (both directions)', async () => {
    // The canonical bug catalog lives in the fixture itself: every
    // planted bug is annotated with a `// IL-DRIFT: <drift-key>`
    // comment, where the key is the exact `<ArtifactType>:<identity> /
    // <obligationKey>` the verifier emits. The test parses those
    // markers and asserts the verifier's drift set equals the marker
    // set — no missing, no extras. Adding or removing a planted bug
    // requires only updating the marker; the test auto-tracks.
    const expected = new Set(
      parseIlDriftMarkers(path.join(FIXTURE_ROOT, 'code/src')),
    );
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

  it('traces single-file delegation handlers (no implementation.missing FPs)', async () => {
    // The transition routes (POST /api/orders/{id}/pay, /ship, /cancel)
    // are registered as `(req, res, next) => transitionEndpoint(...)`.
    // The extractor must follow the call into `transitionEndpoint` and
    // attribute its responses back to the route — otherwise we'd emit
    // false-positive `implementation.missing` drifts for each.
    //
    // Intentional regression cases (marked with // IL-DRIFT: in fixture code)
    // are excluded from the FP check — they are covered by the marker-set test.
    const intentional = new Set(
      parseIlDriftMarkers(path.join(FIXTURE_ROOT, 'code/src')),
    );
    const result = await verify({
      contractsDir: path.join(FIXTURE_ROOT, 'reference/contracts'),
      codeDir: path.join(FIXTURE_ROOT, 'code'),
    });
    const unexpectedMissing = result.drifts.filter(
      (d) => d.obligationKey === 'implementation.missing' && !intentional.has(driftKey(d)),
    );
    expect(unexpectedMissing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Synthesized comparator test for the "Location header missing" drift —
// proves the comparator catches it when the 201 path itself isn't missing.
// ---------------------------------------------------------------------------

import { compareOperation } from '../../packages/contract-verifier/src/comparator/index.js';
import type { OperationContract } from '../../packages/contract-verifier/src/types/index.js';

describe('Operation comparator — header-presence drift', () => {
  it('flags missing Location header when 201 is emitted but header is not', () => {
    const spec: OperationContract = {
      protocol: 'http',
      method: 'POST',
      path: '/api/orders',
      tags: [],
      responses: [
        {
          status: '201',
          condition: { kind: 'success' },
          headers: [{ name: 'location', required: true }],
        },
      ],
    };
    const code: OperationContract = {
      protocol: 'http',
      method: 'POST',
      path: '/api/orders',
      tags: [],
      responses: [
        {
          status: '201',
          headers: [], // no location header
        },
      ],
    };
    const drifts = compareOperation({
      spec,
      code,
      specRef: { type: 'Operation', identity: 'POST /api/orders', quoted: true },
      codeFilePath: '/fake/orders.controller.ts',
      codeDeclarationLine: 1,
    });
    expect(drifts.map((d) => d.obligationKey)).toContain('response.201.headers.location');
  });
});

describe('Operation comparator — status-class matching', () => {
  function specWithStatus(status: string): OperationContract {
    return {
      protocol: 'http',
      method: 'POST',
      path: '/api/things',
      tags: [],
      responses: [{ status, condition: { kind: 'success' } }],
    };
  }
  function codeWithStatuses(statuses: string[]): OperationContract {
    return {
      protocol: 'http',
      method: 'POST',
      path: '/api/things',
      tags: [],
      responses: statuses.map((status) => ({ status })),
    };
  }
  const specRef = { type: 'Operation' as const, identity: 'POST /api/things', quoted: true };
  const compareArgs = { specRef, codeFilePath: '/fake.ts', codeDeclarationLine: 1 };

  it('emits no drift when the spec asks for `2xx` and the code emits 201', () => {
    const drifts = compareOperation({
      spec: specWithStatus('2xx'),
      code: codeWithStatuses(['201']),
      ...compareArgs,
    });
    expect(drifts.filter((d) => d.obligationKey.startsWith('response.'))).toEqual([]);
  });

  it('emits no drift when the spec asks for `2xx` and the code emits 204', () => {
    const drifts = compareOperation({
      spec: specWithStatus('2xx'),
      code: codeWithStatuses(['204']),
      ...compareArgs,
    });
    expect(drifts.filter((d) => d.obligationKey.startsWith('response.'))).toEqual([]);
  });

  it('flags `2xx` as missing when the code only emits 4xx codes', () => {
    const drifts = compareOperation({
      spec: specWithStatus('2xx'),
      code: codeWithStatuses(['400', '404']),
      ...compareArgs,
    });
    expect(drifts.map((d) => d.obligationKey)).toContain('response.2xx');
  });

  it('flags a literal status mismatch even when code emits a sibling 2xx', () => {
    // `response 200` is more specific than `2xx`. If the spec asks for
    // exactly 200, a code that emits 201 should still drift — this is
    // distinct from the class-match path.
    const drifts = compareOperation({
      spec: specWithStatus('200'),
      code: codeWithStatuses(['201']),
      ...compareArgs,
    });
    expect(drifts.map((d) => d.obligationKey)).toContain('response.200');
  });
});
