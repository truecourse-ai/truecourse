/**
 * The behavior-hash identity for per-finding dismissals (design v8 §1, B1):
 * `scenarioHashFromYaml` hashes ONLY the behavioral surface
 * `{driver, setup, steps, normalize}` of a serialized scenario — title/id/binds/
 * guard are display or bookkeeping and must never move the hash — via the lenient
 * `ScenarioBehaviorSchema` so old-format yaml still derives. A yaml that fails
 * behavioral validation derives NO key (undefined → not dismissible).
 */
import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { scenarioHashFromYaml, ScenarioBehaviorSchema } from '../../packages/shared/src/guard/scenario-hash';
import { guardFindingKey, GUARD_FORMAT_VERSION, type GuardScenario } from '../../packages/shared/src/guard/index';
import { serializeScenarioYaml } from '../../packages/guard-generator/src/serialize';

/** A representative BUILT scenario (id/binds/guard injected, as generate serializes). */
function built(over: Partial<GuardScenario> = {}): GuardScenario {
  return {
    guard: GUARD_FORMAT_VERSION,
    id: 'version.1',
    title: 'the --version flag prints the semver',
    binds: { doc: 'docs/cli.md', section: 'version', fingerprint: 'sha256:abc' },
    driver: 'cli',
    steps: [{ run: ['--version'], expect: { exit: 0, stdout: { matches: '\\d+\\.\\d+\\.\\d+' } } }],
    normalize: [],
    ...over,
  };
}

const RICH_SETUPS: GuardScenario[] = [
  built(),
  built({ setup: { files: { 'a.txt': 'hi' }, env: { FOO: 'bar' } } }),
  built({ setup: { files: { 'a.txt': 'x' }, git: { commits: [{ files: ['a.txt'], message: 'init' }], staged: ['a.txt'], branch: 'main' } } }),
  built({
    steps: [
      { run: ['init'], expect: { exit: 0, files: { 'out.json': { exists: true, contains: 'ok' } } } },
      { run: ['status'], stdin: 'y\n', repeat: 2, expect: { exit: 0, stderr: { contains: 'clean' } } },
    ],
    normalize: ['timestamps', 'abs-paths', 'versions', 'durations'],
  }),
];

describe('scenarioHashFromYaml — the B1 acceptance criteria', () => {
  it('is stable across a second dump→load→dump cycle (formatting churn immune)', () => {
    for (const s of RICH_SETUPS) {
      const once = serializeScenarioYaml(s);
      const twice = yaml.dump(yaml.load(once), { lineWidth: 40, noRefs: true }); // different dump style
      expect(scenarioHashFromYaml(once)).toBeDefined();
      expect(scenarioHashFromYaml(twice)).toBe(scenarioHashFromYaml(once));
    }
  });

  it('two behaviorally identical scenarios differing only in title/id/binds hash equal', () => {
    const a = serializeScenarioYaml(built());
    const b = serializeScenarioYaml(
      built({ id: 'version.7', title: 'REWORDED title', binds: { doc: 'docs/cli.md', section: 'version', fingerprint: 'sha256:other' } }),
    );
    expect(scenarioHashFromYaml(b)).toBe(scenarioHashFromYaml(a));
  });

  it('behavioral changes move the hash', () => {
    const a = serializeScenarioYaml(built());
    const b = serializeScenarioYaml(built({ steps: [{ run: ['--help'], expect: { exit: 0 } }] }));
    expect(scenarioHashFromYaml(b)).not.toBe(scenarioHashFromYaml(a));
  });

  it('a yaml under a DIFFERENT guard format version (and one missing id/binds) still derives, equal to its current twin', () => {
    const current = serializeScenarioYaml(built());
    const bumped = yaml.dump({ ...(yaml.load(current) as object), guard: 999 }, { lineWidth: -1, noRefs: true });
    expect(scenarioHashFromYaml(bumped)).toBe(scenarioHashFromYaml(current));

    const loaded = yaml.load(current) as Record<string, unknown>;
    delete loaded.id;
    delete loaded.binds;
    const stripped = yaml.dump(loaded, { lineWidth: -1, noRefs: true });
    expect(scenarioHashFromYaml(stripped)).toBe(scenarioHashFromYaml(current));
  });

  it('an unknown top-level key derives and does not affect the hash', () => {
    const current = serializeScenarioYaml(built());
    const junk = yaml.dump({ ...(yaml.load(current) as object), modelJunk: { a: 1 } }, { lineWidth: -1, noRefs: true });
    expect(scenarioHashFromYaml(junk)).toBe(scenarioHashFromYaml(current));
  });

  it('derives no key for unparseable yaml or a failed behavioral validation', () => {
    expect(scenarioHashFromYaml(':: not yaml ::[')).toBeUndefined();
    expect(scenarioHashFromYaml('driver: cli\nsteps: []\n')).toBeUndefined(); // steps.min(1)
    expect(scenarioHashFromYaml('driver: web\nsteps:\n  - run: []\n    expect: {}\n')).toBeUndefined(); // non-cli driver
  });

  it('the hash is 16 hex chars (the established truncated-sha256 pattern)', () => {
    expect(scenarioHashFromYaml(serializeScenarioYaml(built()))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('ScenarioBehaviorSchema — the lenient derivation gate', () => {
  it('accepts behavioral fields alone and defaults normalize to []', () => {
    const parsed = ScenarioBehaviorSchema.parse({
      driver: 'cli',
      steps: [{ run: ['--version'], expect: { exit: 0 } }],
    });
    expect(parsed.normalize).toEqual([]);
    expect(parsed.setup).toBeUndefined();
  });

  it('rejects a behavioral sub-schema break (unknown step key) — the cross-bump degradation case', () => {
    expect(() =>
      ScenarioBehaviorSchema.parse({
        driver: 'cli',
        steps: [{ run: ['x'], expect: { exit: 0 }, futureVerb: true }],
      }),
    ).toThrow();
  });
});

describe('guardFindingKey', () => {
  it('is the NUL-delimited doc + anchor + scenarioHash trio', () => {
    expect(guardFindingKey('d', 'a', 'h')).toBe('d\0a\0h');
    expect(guardFindingKey('d', 'a', 'h')).not.toBe(guardFindingKey('d', 'a', 'h2'));
  });
});
