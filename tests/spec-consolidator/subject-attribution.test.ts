import { describe, expect, it } from 'vitest';
import {
  applySubjectAttribution,
  DocSubjectSchema,
  type RelevanceVerdict,
  identityFingerprint,
  resolveRepoIdentity,
  taglineFromReadme,
  MAX_DESCRIPTION_CHARS,

} from '../../packages/spec-consolidator/src/index.js';

const verdict = (over: Partial<RelevanceVerdict>): RelevanceVerdict => ({
  path: 'docs/x.md',
  include: true,
  reason: 'well-written product requirements',
  ...over,
});

describe('applySubjectAttribution — attribution beats content', () => {
  it('different-product drops, however good the content — normalized to third-party for the backstop', () => {
    const out = applySubjectAttribution(
      verdict({ subject: 'different-product', include: true, category: undefined }),
    );
    expect(out.include).toBe(false);
    expect(out.category).toBe('third-party');
  });

  it('different-product overrides even an explicit non-third-party category from the model', () => {
    const out = applySubjectAttribution(
      verdict({ subject: 'different-product', include: true, category: 'process' as never }),
    );
    expect(out.include).toBe(false);
    expect(out.category).toBe('third-party');
  });

  it('this-product leaves the content judgment untouched', () => {
    const kept = applySubjectAttribution(verdict({ subject: 'this-product', include: true }));
    expect(kept.include).toBe(true);
    const dropped = applySubjectAttribution(
      verdict({ subject: 'this-product', include: false, category: 'process' as never }),
    );
    expect(dropped.include).toBe(false);
  });

  it('unknown and absent subjects fall through to the content judgment', () => {
    expect(applySubjectAttribution(verdict({ subject: 'unknown', include: true })).include).toBe(true);
    expect(applySubjectAttribution(verdict({ include: true })).include).toBe(true);
  });

  it('the subject enum is closed to the three attribution answers', () => {
    expect(DocSubjectSchema.options).toEqual(['this-product', 'different-product', 'unknown']);
    expect(DocSubjectSchema.safeParse('fixture').success).toBe(false);
  });
});

describe('repo identity — product understanding (description)', () => {
  it('prefers the package.json description and folds it into the fingerprint', () => {
    const base = { packageJson: { name: 'acme-flow', description: 'Workflow engine for billing teams' } };
    const id = resolveRepoIdentity(base);
    expect(id?.description).toBe('Workflow engine for billing teams');
    const without = resolveRepoIdentity({ packageJson: { name: 'acme-flow' } });
    expect(without?.description).toBeUndefined();
    expect(identityFingerprint(id!)).not.toBe(identityFingerprint(without!));
  });

  it('falls back to the README tagline and bounds it at resolution', () => {
    const long = 'Billing workflows for finance teams that outgrew spreadsheets. '.repeat(12);
    const id = resolveRepoIdentity({
      packageJson: { name: 'acme-flow' },
      readmeText: `# Acme Flow\n\n${long}\n`,
    });
    expect(id?.description).toBeDefined();
    expect(id!.description!.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS + 1); // +1: the ellipsis
    expect(id!.description!.endsWith('…')).toBe(true);
    // The raw extractor stays unbounded by design — the clamp lives at resolution.
    expect(taglineFromReadme(`# Acme Flow\n\n${long}\n`)!.length).toBeGreaterThan(MAX_DESCRIPTION_CHARS);
  });

  it('never reads a heading or tagline out of a fenced code block', () => {
    const readme = [
      '```bash',
      '# Install',
      'npm install acme-flow',
      '```',
      '',
      '# Acme Flow',
      '',
      'Billing workflows without the spreadsheets.',
      '',
    ].join('\n');
    expect(taglineFromReadme(readme)).toBe('Billing workflows without the spreadsheets.');
    const id = resolveRepoIdentity({ packageJson: { name: 'acme-flow' }, readmeText: readme });
    expect(id?.description).toBe('Billing workflows without the spreadsheets.');
    expect(id?.description).not.toMatch(/install/i);
  });


  it("a section H1 after prose is NEVER a name seed, and the tagline comes from above it (the TrueCourse README shape)", () => {
    const readme = [
      '![Acme](assets/logo.png)',
      '',
      '**Workflow engine for billing teams**',
      '',
      '*1,500 rules, zero spreadsheets.*',
      '',
      '# Install',
      '',
      'npm install -g acme-flow',
      '',
    ].join('\n');
    const id = resolveRepoIdentity({ packageJson: { name: 'acme-flow' }, readmeText: readme });
    expect(id?.aliases).not.toContain('Install');
    expect(id?.description).toBe('Workflow engine for billing teams');
  });

  it('a top-of-document H1 (only decoration above) still seeds the title', () => {
    const readme = '![logo](l.png)\n\n# acme-flow\n\nBilling workflows without the spreadsheets.\n';
    const id = resolveRepoIdentity({ readmeText: readme, dirBasename: 'tmp-x' });
    expect(id?.name).toBe('acme-flow');
    expect(id?.description).toBe('Billing workflows without the spreadsheets.');
  });

  it('degrades to name+aliases when no source offers a description', () => {
    const id = resolveRepoIdentity({ packageJson: { name: 'acme-flow' } });
    expect(id?.name).toBe('acme-flow');
    expect(id?.description).toBeUndefined();
  });
});
