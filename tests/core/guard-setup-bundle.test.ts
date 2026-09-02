/**
 * The guard setup bundle's fs half: which files `guard setup` leaves behind get
 * carried across an ephemeral clone, and that materializing a bundle can never
 * write outside the target tree.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectGuardSetupBundle,
  materializeGuardSetupBundle,
} from '../../packages/core/src/services/guard-setup/bundle';

let root: string;

const write = (repoRoot: string, rel: string, body: string): void => {
  const full = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-setup-bundle-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A tree with every bundle member plus the files that must stay behind. */
function seedRepo(repoRoot: string): void {
  write(repoRoot, '.truecourse/guard/setup.json', '{"steps":[{"step":"recipe"}]}');
  write(repoRoot, '.truecourse/guard/setup.findings.md', '# findings\n- one\n');
  write(repoRoot, '.truecourse/guard/interfaces.json', '{"version":2,"interfaces":[]}');
  write(repoRoot, '.truecourse/guard/interfaces.authored.json', '{"version":2,"interfaces":[]}');
  write(repoRoot, '.truecourse/guard/interfaces.findings.md', '# interface findings\n');
  write(
    repoRoot,
    '.truecourse/scenarios/recipe.json',
    JSON.stringify({ api: { seed: { script: 'scripts/seed.ts' } } }),
  );
  write(repoRoot, '.truecourse/scenarios/dependencies.json', '{"dependencies":[]}');
  write(repoRoot, '.truecourse/scenarios/dependencies.settle.json', '{"catalogSessionFingerprint":"f"}');
  write(repoRoot, 'docker-compose.guard.yml', 'services: {}\n');
  write(repoRoot, 'scripts/seed.ts', 'export const seed = 1;\n');
  // Not the bundle's: cached, or a secrets overlay.
  write(repoRoot, '.truecourse/.cache/guard/recipe/x.json', '{}');
  write(repoRoot, '.truecourse/scenarios/dependencies.local.json', '{"secret":1}');
  write(repoRoot, '.truecourse/scenarios/externals.local.json', '{"key":1}');
}

describe('collectGuardSetupBundle', () => {
  it('collects exactly the durable setup outputs, including the recipe seed script', () => {
    seedRepo(root);

    const files = collectGuardSetupBundle(root);

    expect(Object.keys(files).sort()).toEqual([
      '.truecourse/guard/interfaces.authored.json',
      '.truecourse/guard/interfaces.findings.md',
      '.truecourse/guard/interfaces.json',
      '.truecourse/guard/setup.findings.md',
      '.truecourse/guard/setup.json',
      '.truecourse/scenarios/dependencies.json',
      '.truecourse/scenarios/dependencies.settle.json',
      '.truecourse/scenarios/recipe.json',
      'docker-compose.guard.yml',
      'scripts/seed.ts',
    ]);
    expect(files['scripts/seed.ts']).toBe('export const seed = 1;\n');
  });

  it('skips missing members and a seed script the recipe names but does not have', () => {
    write(root, '.truecourse/scenarios/recipe.json', JSON.stringify({ api: { seed: { script: 'nope.ts' } } }));

    expect(Object.keys(collectGuardSetupBundle(root))).toEqual(['.truecourse/scenarios/recipe.json']);
  });

  it('ignores a seed script that escapes the repo', () => {
    write(root, '.truecourse/scenarios/recipe.json', JSON.stringify({ api: { seed: { script: '../outside.ts' } } }));

    expect(Object.keys(collectGuardSetupBundle(root))).toEqual(['.truecourse/scenarios/recipe.json']);
  });

  it('returns an empty bundle for a tree setup never touched', () => {
    expect(collectGuardSetupBundle(root)).toEqual({});
  });
});

describe('materializeGuardSetupBundle', () => {
  it('reproduces the collected tree byte-identically', () => {
    seedRepo(root);
    const files = collectGuardSetupBundle(root);
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-setup-clone-'));

    try {
      materializeGuardSetupBundle(fresh, files);

      for (const [rel, body] of Object.entries(files)) {
        expect(fs.readFileSync(path.join(fresh, rel), 'utf-8')).toBe(body);
      }
      expect(collectGuardSetupBundle(fresh)).toEqual(files);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('refuses a traversing path and writes nothing', () => {
    expect(() => materializeGuardSetupBundle(root, { '../escape.txt': 'x' })).toThrow(/unsafe|escape/i);
    expect(fs.existsSync(path.join(root, '..', 'escape.txt'))).toBe(false);
  });

  it('refuses an absolute path', () => {
    expect(() => materializeGuardSetupBundle(root, { '/etc/passwd': 'x' })).toThrow();
  });
});
