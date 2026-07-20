/**
 * Repo self-identity — who is "this repository"? The relevance classifier drops
 * docs about a "THIRD-PARTY / external system", but until it is told which
 * product IS ours, every doc that names its own product reads as a vendor's.
 * These tests pin the resolver over a pure `RepoIdentityInput` — no fixture
 * repos, so the fs half (`readRepoIdentityInput`) stays a thin, separately
 * exercised shim.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveRepoIdentity,
  aliasMatcher,
  identityFingerprint,
  identityBlock,
  stripForNames,
} from '../../packages/spec-consolidator/src/index.js';

describe('resolveRepoIdentity — metadata seeds', () => {
  it('takes the repo name from a git remote', () => {
    const id = resolveRepoIdentity({ gitRemoteUrl: 'git@github.com:calcom/cal.com.git' });
    expect(id?.name).toBe('cal.com');
    expect(id?.aliases).toContain('cal.com');
    expect(id?.sources).toContain('git-remote');
  });

  it('parses https remotes and strips the .git suffix', () => {
    const id = resolveRepoIdentity({ gitRemoteUrl: 'https://github.com/wekan/wekan.git' });
    expect(id?.name).toBe('wekan');
    expect(id?.aliases).toContain('wekan');
  });

  it('prefers an explicit repoFullName over every other seed', () => {
    const id = resolveRepoIdentity({
      repoFullName: 'calcom/cal.com',
      dirBasename: 'tc-gate-scan-abc123',
    });
    expect(id?.name).toBe('cal.com');
    expect(id?.aliases).not.toContain('tc-gate-scan-abc123');
  });

  it('drops the @scope/ from a package.json name and keeps the description', () => {
    const id = resolveRepoIdentity({
      packageJson: { name: '@calcom/web', description: 'Scheduling infrastructure' },
    });
    expect(id?.name).toBe('web');
    expect(id?.description).toBe('Scheduling infrastructure');
  });

  it('returns null when no seed identifies the repo', () => {
    expect(resolveRepoIdentity({})).toBeNull();
  });

  // MIN_MATCHABLE_ALIAS. `cal` (from splitting `cal.com`) is a real English word
  // and a substring of hundreds of unrelated tokens; matching on it would make
  // the third-party backstop a re-include-everything switch. It may still ANCHOR
  // corpus expansion — that is the `cores` set, which never reaches the prompt.
  it('never emits a matchable alias shorter than 4 chars', () => {
    const id = resolveRepoIdentity({ gitRemoteUrl: 'git@github.com:calcom/cal.com.git' });
    expect(id?.aliases).not.toContain('cal');
    expect(id?.aliases.every((a) => a.length >= 4)).toBe(true);
  });

  it('de-duplicates aliases that differ only in case or separator', () => {
    const id = resolveRepoIdentity({
      repoFullName: 'calcom/cal.com',
      packageJson: { name: 'calcom' },
    });
    const lowered = id!.aliases.map((a) => a.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });
});

describe('resolveRepoIdentity — README H1 seed', () => {
  it('takes a title-shaped H1, stripped of badge/link decoration', () => {
    const id = resolveRepoIdentity({ readmeH1: '[![logo](x.png)](y) **Wekan**' });
    expect(id?.aliases).toContain('Wekan');
  });

  it('ignores an H1 that is a sentence, not a title', () => {
    const id = resolveRepoIdentity({
      dirBasename: 'checkout',
      readmeH1: 'Welcome to the Wekan developer documentation wiki',
    });
    expect(id?.aliases.some((a) => a.includes(' '))).toBe(false);
  });
});

describe('aliasMatcher', () => {
  it('matches an alias regardless of case or its internal separator', () => {
    const re = aliasMatcher(['cal.com']);
    for (const s of ['Read the Cal.com docs', 'the calcom API', 'CAL-COM auth']) {
      expect(re.test(s)).toBe(true);
    }
  });

  // `\b` does not behave at the `.` in `cal.com` — the boundary between `l` and
  // `.` is a word boundary, so `\bcal\.com\b` would happily match inside
  // `xcal.comy`. Custom lookarounds are what make this correct.
  it('does not match inside a longer word', () => {
    const re = aliasMatcher(['cal.com']);
    expect(re.test('calcomputer is unrelated')).toBe(false);
    expect(re.test('precalcom')).toBe(false);
  });

  it('never inserts a separator the alias does not have', () => {
    // `wekan` has no separator, so `we-kan` is a different word, not our repo.
    const re = aliasMatcher(['wekan']);
    expect(re.test('we-kan board')).toBe(false);
    expect(re.test('a Wekan board')).toBe(true);
  });

  it('matches nothing when there are no aliases', () => {
    expect(aliasMatcher([]).test('Cal.com Stripe Wekan')).toBe(false);
  });

  it('treats regex metacharacters in an alias as literals', () => {
    const re = aliasMatcher(['c++builder']);
    expect(re.test('using C++Builder here')).toBe(true);
    expect(re.test('cbuilder')).toBe(false);
  });
});

describe('identityFingerprint', () => {
  // Corpus-derived aliases arrive in doc-discovery order. If the fingerprint
  // tracked that order, adding an unrelated doc would re-key every cached
  // relevance verdict in the repo and silently re-spend the whole corpus.
  it('is independent of alias order and case', () => {
    const a = identityFingerprint({ name: 'cal.com', aliases: ['Cal.com', 'Cal.diy'], sources: [] });
    const b = identityFingerprint({ name: 'cal.com', aliases: ['cal.diy', 'CAL.COM'], sources: [] });
    expect(a).toBe(b);
  });

  it('changes when the alias set changes', () => {
    const a = identityFingerprint({ name: 'cal.com', aliases: ['cal.com'], sources: [] });
    const b = identityFingerprint({ name: 'cal.com', aliases: ['cal.com', 'cal.diy'], sources: [] });
    expect(a).not.toBe(b);
  });

  it('has a stable non-empty value for no identity', () => {
    expect(identityFingerprint(null)).toBe(identityFingerprint(null));
    expect(identityFingerprint(null).length).toBeGreaterThan(0);
  });

  // The fingerprint must hash exactly what reaches the prompt — no more. A
  // `sources` list is debug metadata; letting it into the hash would re-key the
  // cache when a repo merely gains a package.json.
  it('ignores fields that never reach the prompt', () => {
    const a = identityFingerprint({ name: 'cal.com', aliases: ['cal.com'], sources: ['git-remote'] });
    const b = identityFingerprint({ name: 'cal.com', aliases: ['cal.com'], sources: ['manifest'] });
    expect(a).toBe(b);
  });
});

describe('identityBlock', () => {
  it('names the repo and its aliases under an IDENTITY heading', () => {
    const block = identityBlock({
      name: 'cal.com',
      description: 'Scheduling infrastructure',
      aliases: ['Cal.com', 'Cal.diy'],
      sources: ['git-remote'],
    });
    expect(block).toMatch(/IDENTITY/);
    expect(block).toContain('cal.com');
    expect(block).toContain('Cal.diy');
    expect(block).toContain('Scheduling infrastructure');
  });

  it('is empty when there is no identity, so the prompt is unchanged', () => {
    expect(identityBlock(null)).toBe('');
  });
});

/**
 * Name extraction and the third-party backstop must both read a doc with its
 * MARKUP and CODE removed. An `import { x } from '@calcom/lib'` in a fenced
 * block, or an MDX `<CalcomProvider>` tag, says nothing about whose product the
 * prose is describing — matching on those would re-include a genuine vendor doc
 * and turn the backstop into a re-include-everything switch.
 */
describe('stripForNames', () => {
  it('removes fenced code blocks', () => {
    const out = stripForNames("Prose here.\n\n```ts\nimport { x } from '@calcom/lib';\n```\n\nMore prose.");
    expect(out).not.toMatch(/calcom/i);
    expect(out).toContain('Prose here.');
    expect(out).toContain('More prose.');
  });

  it('removes inline code spans', () => {
    expect(stripForNames('Run `wekan-cli start` to boot.')).not.toMatch(/wekan/i);
  });

  // Link TARGETS are the sneakiest false positive: `[the docs](https://docs.google.com/x)`
  // would otherwise make Google a frequent proper noun in any repo that links a
  // shared doc. The link TEXT is real prose and stays.
  it('removes URLs and link targets but keeps link text', () => {
    const out = stripForNames('See [the scheduling guide](https://docs.google.com/x) and <https://stripe.com/y>.');
    expect(out).toContain('the scheduling guide');
    expect(out).not.toMatch(/google/i);
    expect(out).not.toMatch(/stripe/i);
  });

  it('removes raw HTML and JSX tags with their attributes', () => {
    const out = stripForNames('<ResponseField name="Foo" type="Bar">The booking id.</ResponseField>');
    expect(out).not.toMatch(/ResponseField|Foo|Bar/);
    expect(out).toContain('The booking id.');
  });

  it('drops pure-markup lines', () => {
    expect(stripForNames('| --- | --- |\n===\nReal Sentence here.').trim()).toBe('Real Sentence here.');
  });
});
