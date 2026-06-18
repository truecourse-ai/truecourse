import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { verify } from '../../packages/contract-verifier/src/verify.js';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/sample-csharp-project-il');

/**
 * Parse `// IL-DRIFT: <drift-key>` markers from every C# file under the
 * fixture's code dir. Mirror of the Python/JS harnesses but for C# comment
 * syntax. Each marker is the exact drift key the verifier emits —
 * `<ArtifactType>:<identity> / <obligationKey>`.
 */
function parseIlDriftMarkers(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'bin' ||
        entry.name === 'obj'
      )
        continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.cs$/.test(entry.name)) continue;
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

// C# (ASP.NET Core + EF Core + Dapper) drift verification, end to end. The
// fixture's 47 `// IL-DRIFT:` markers are the oracle; the verifier must emit
// exactly that set across all 15 artifact kinds (Operation, Enum, NamedConstant,
// QueryRule, Entity, StateMachine, Formula, EffectGroup, AuthorizationRule,
// ArchitectureDecision, ForbiddenArtifact, ErrorEnvelope, Pagination, Idempotency,
// AuthRequirement). C# support is parser-only on the analyzer side (tree-sitter
// grammar) + per-language matchers in this package — no language server.
describe('Contract verifier — end-to-end on the C# fixture', () => {
  it('runs without resolver errors', async () => {
    const result = await verify({
      contractsDir: path.join(FIXTURE_ROOT, 'reference/contracts'),
      codeDir: path.join(FIXTURE_ROOT, 'code'),
    });
    expect(result.resolverErrors).toEqual([]);
  });

  it('drift set matches the `// IL-DRIFT:` markers in fixture code (both directions)', async () => {
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
