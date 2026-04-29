import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { syncShippedSkills } from '../../tools/cli/src/commands/helpers';

const LOCK_FILE = '.truecourse-skills.json';

function sha(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('syncShippedSkills (hash-based safe overwrite)', () => {
  let repoDir: string;
  let srcDir: string;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-skills-repo-'));
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-skills-src-'));
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  function shipSkill(name: string, content: string): void {
    fs.mkdirSync(path.join(srcDir, name), { recursive: true });
    fs.writeFileSync(path.join(srcDir, name, 'SKILL.md'), content);
  }

  function installSkillLocally(name: string, content: string): void {
    const dir = path.join(repoDir, '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  }

  function writeLock(entries: Record<string, string>): void {
    const skillsParent = path.join(repoDir, '.claude', 'skills');
    fs.mkdirSync(skillsParent, { recursive: true });
    fs.writeFileSync(path.join(skillsParent, LOCK_FILE), JSON.stringify(entries));
  }

  function readSkill(name: string): string {
    return fs.readFileSync(
      path.join(repoDir, '.claude', 'skills', name, 'SKILL.md'),
      'utf-8',
    );
  }

  function readLock(): Record<string, string> {
    const lockPath = path.join(repoDir, '.claude', 'skills', LOCK_FILE);
    if (!fs.existsSync(lockPath)) return {};
    return JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  }

  it('overwrites an unmodified skill when shipped version is newer', () => {
    shipSkill('foo', 'v2');
    installSkillLocally('foo', 'v1');
    writeLock({ foo: sha('v1') });

    syncShippedSkills(repoDir, srcDir);

    expect(readSkill('foo')).toBe('v2');
    expect(readLock().foo).toBe(sha('v2'));
  });

  it('leaves a user-customized skill untouched', () => {
    shipSkill('foo', 'v2');
    installSkillLocally('foo', 'v1-edited-by-user');
    writeLock({ foo: sha('v1') });

    syncShippedSkills(repoDir, srcDir);

    expect(readSkill('foo')).toBe('v1-edited-by-user');
    expect(readLock().foo).toBe(sha('v1'));
  });

  it('migrates a pre-lockfile install by overwriting and seeding the lockfile', () => {
    shipSkill('foo', 'v2');
    installSkillLocally('foo', 'v1-from-old-truecourse-version');
    // no lockfile — represents a user who installed before lockfile support

    syncShippedSkills(repoDir, srcDir);

    expect(readSkill('foo')).toBe('v2');
    expect(readLock().foo).toBe(sha('v2'));
  });

  it('migrates only the pre-lockfile entries; recorded entries respect customization', () => {
    shipSkill('migrating', 'v2');
    shipSkill('customized', 'v2');

    installSkillLocally('migrating', 'v1-pre-lockfile');
    installSkillLocally('customized', 'v1-with-edits');

    // Lockfile knows about `customized` (user edited it after last install)
    // but not about `migrating` (installed before lockfile existed).
    writeLock({ customized: sha('v1') });

    syncShippedSkills(repoDir, srcDir);

    expect(readSkill('migrating')).toBe('v2');
    expect(readSkill('customized')).toBe('v1-with-edits');

    expect(readLock()).toEqual({
      migrating: sha('v2'),
      customized: sha('v1'),
    });
  });

  it('is a no-op when shipped matches on-disk', () => {
    shipSkill('foo', 'v1');
    installSkillLocally('foo', 'v1');
    writeLock({ foo: sha('v1') });

    syncShippedSkills(repoDir, srcDir);

    expect(readSkill('foo')).toBe('v1');
    expect(readLock().foo).toBe(sha('v1'));
  });

  it('refreshes a stale lockfile entry when shipped == on-disk', () => {
    shipSkill('foo', 'v1');
    installSkillLocally('foo', 'v1');
    writeLock({ foo: 'stale-sha-from-old-format' });

    syncShippedSkills(repoDir, srcDir);

    expect(readLock().foo).toBe(sha('v1'));
  });

  it('handles a mix: one current, one upgradable, one customized', () => {
    shipSkill('current', 'v1');
    shipSkill('upgradable', 'v2');
    shipSkill('customized', 'v2');

    installSkillLocally('current', 'v1');
    installSkillLocally('upgradable', 'v1');
    installSkillLocally('customized', 'v1-with-edits');

    writeLock({
      current: sha('v1'),
      upgradable: sha('v1'),
      customized: sha('v1'),
    });

    syncShippedSkills(repoDir, srcDir);

    expect(readSkill('current')).toBe('v1');
    expect(readSkill('upgradable')).toBe('v2');
    expect(readSkill('customized')).toBe('v1-with-edits');

    expect(readLock()).toEqual({
      current: sha('v1'),
      upgradable: sha('v2'),
      customized: sha('v1'),
    });
  });

  it('skips skills that are shipped but not installed locally', () => {
    shipSkill('only-shipped', 'v1');
    // never installed locally
    syncShippedSkills(repoDir, srcDir);

    expect(fs.existsSync(path.join(repoDir, '.claude', 'skills', 'only-shipped'))).toBe(false);
    expect(readLock()).toEqual({});
  });
});
