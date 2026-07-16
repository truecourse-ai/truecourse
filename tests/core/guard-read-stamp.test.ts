/**
 * Stamp-on-read (design v8 §1b/R-D): every findings-consuming report read —
 * `readGuardReport` AND `readGuardResultForView` — decorates each served finding
 * with the server-computed `findingKey` derived from its verbatim stored `yaml`.
 * Keys are NEVER persisted (`result.json` bytes stay what generate wrote), so a
 * stored report never carries them — the stamp is what makes old stored reports
 * dismissible on day one. A finding with no yaml, or whose yaml fails behavioral
 * derivation, gets no key (not dismissible; counts as active).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGuardReport, readGuardResultForView } from '../../packages/core/src/commands/guard-read';
import { resetGuardStore } from '../../packages/core/src/lib/guard-store';
import { guardFindingKey, GUARD_FORMAT_VERSION } from '../../packages/shared/src/guard/index';
import { scenarioHashFromYaml } from '../../packages/shared/src/guard/scenario-hash';

const SCENARIO_YAML = [
  `guard: ${GUARD_FORMAT_VERSION}`,
  'id: version.1',
  'title: prints the semver',
  'binds:',
  '  doc: docs/cli.md',
  '  section: version',
  '  fingerprint: sha256:abc',
  'driver: cli',
  'steps:',
  '  - run:',
  '      - --version',
  '    expect:',
  '      exit: 0',
  'normalize: []',
  '',
].join('\n');

/** A pre-feature stored report: findings carry yaml (or not) but never findingKey. */
function storedReport() {
  const finding = (over: Record<string, unknown>) => ({
    doc: 'docs/cli.md',
    anchor: 'version',
    title: 'prints the semver',
    step: 1,
    expected: 'e',
    actual: 'a',
    ...over,
  });
  return {
    generatedAt: '2026-07-01T00:00:00.000Z',
    status: 'ok',
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [
      finding({ yaml: SCENARIO_YAML, claim: 'the --version flag prints the semver' }),
      finding({ kind: 'fidelity', yaml: SCENARIO_YAML.replace('--version', '--help') }),
      finding({ anchor: 'no-yaml' }), // pre-item-19 report row: no yaml at all
      finding({ anchor: 'bad-yaml', yaml: 'driver: web\nsteps: []\n' }), // fails behavioral derivation
    ],
    errors: [],
    extractionFailures: [],
    orphaned: [],
  };
}

describe('stamp-on-read at the store-read choke point', () => {
  let repo: string;
  beforeEach(() => {
    resetGuardStore();
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-stamp-'));
    const guardDir = path.join(repo, '.truecourse', 'guard');
    fs.mkdirSync(guardDir, { recursive: true });
    fs.writeFileSync(path.join(guardDir, 'result.json'), JSON.stringify(storedReport()));
  });
  afterEach(() => {
    resetGuardStore();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  const expectedKey = guardFindingKey('docs/cli.md', 'version', scenarioHashFromYaml(SCENARIO_YAML)!);

  it('readGuardReport stamps findingKey on every finding with derivable yaml', async () => {
    const report = await readGuardReport(repo);
    expect(report).not.toBeNull();
    const [birth, fidelity, noYaml, badYaml] = report!.birthFindings;
    expect(birth.findingKey).toBe(expectedKey);
    // Fidelity findings are first-class dismissible — stamped identically (§2a).
    expect(fidelity.findingKey).toBeDefined();
    expect(fidelity.findingKey).not.toBe(birth.findingKey);
    expect(noYaml.findingKey).toBeUndefined();
    expect(badYaml.findingKey).toBeUndefined();
  });

  it('readGuardResultForView stamps too — the regen-trigger path reads keys (R-D)', async () => {
    const report = await readGuardResultForView(repo);
    expect(report).not.toBeNull();
    expect(report!.birthFindings[0].findingKey).toBe(expectedKey);
    expect(report!.birthFindings[2].findingKey).toBeUndefined();
  });

  it('never persists the stamp — the stored report bytes are unchanged by reads', async () => {
    await readGuardReport(repo);
    await readGuardResultForView(repo);
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(repo, '.truecourse', 'guard', 'result.json'), 'utf-8'),
    ) as { birthFindings: Record<string, unknown>[] };
    for (const f of onDisk.birthFindings) expect(f.findingKey).toBeUndefined();
  });
});
