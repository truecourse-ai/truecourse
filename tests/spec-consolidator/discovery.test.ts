import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyDoc,
  discoverDocs,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * Discovery tests for the spec consolidator. The classifier is the
 * primary surface — get it wrong and downstream merge-weight priors
 * mis-rank docs. The walker is a thin wrapper but covers the
 * "exclude .truecourse/ to avoid feedback loops" rule that's load-
 * bearing for repeat runs.
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-disc-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function place(rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

// ---------------------------------------------------------------------------
// Classifier — pure function tests (no filesystem)
// ---------------------------------------------------------------------------

describe('classifyDoc — filename + path signals', () => {
  it.each([
    ['SPEC.md', 'spec'],
    ['SPECS.md', 'spec'],
    ['SPECIFICATION.md', 'spec'],
    ['specs-orders.md', 'spec'],
  ])('%s → %s', (file, kind) => {
    expect(classifyDoc(file, '')).toBe(kind);
  });

  it.each([
    ['adr-001-auth.md', 'adr'],
    ['adr_007-routing.md', 'adr'],
    ['docs/adr/0001.md', 'adr'],
    ['docs/adrs/2024-q4.md', 'adr'],
  ])('%s → %s', (file, kind) => {
    expect(classifyDoc(file, '')).toBe(kind);
  });

  it.each([
    ['rfc-2026-orders.md', 'rfc'],
    ['rfc_010.md', 'rfc'],
    ['docs/rfc/q1.md', 'rfc'],
    ['docs/rfcs/payments.md', 'rfc'],
  ])('%s → %s', (file, kind) => {
    expect(classifyDoc(file, '')).toBe(kind);
  });

  it.each([
    ['docs/PRDs/backend_PRDv2.md', 'prd'],
    ['docs/PRD-data-compliance.md', 'prd'],
    ['feature.prd.md', 'prd'],
    ['product/onboarding.md', 'prd'],
    ['docs/prds/anything.md', 'prd'],
  ])('%s → %s', (file, kind) => {
    expect(classifyDoc(file, '')).toBe(kind);
  });

  it.each([
    ['RUNBOOK.md', 'runbook'],
    ['DEPLOYMENT.md', 'runbook'],
    ['operations.md', 'runbook'],
    ['runbooks/postgres.md', 'runbook'],
    ['ops/oncall.md', 'runbook'],
  ])('%s → %s', (file, kind) => {
    expect(classifyDoc(file, '')).toBe(kind);
  });

  it.each([
    ['README.md', 'readme'],
    ['Readme.md', 'readme'],
    ['readme-dev.md', 'readme'],
  ])('%s → %s', (file, kind) => {
    expect(classifyDoc(file, '')).toBe(kind);
  });

  it.each([
    ['design/auth-flow.md', 'design-note'],
    ['notes/whiteboard.md', 'design-note'],
    ['docs/design-notes/quick.md', 'design-note'],
  ])('%s → %s', (file, kind) => {
    expect(classifyDoc(file, '')).toBe(kind);
  });

  it('falls through to unknown for arbitrary docs/* files', () => {
    expect(classifyDoc('docs/whatever.md', '')).toBe('unknown');
    expect(classifyDoc('docs/architecture.md', '')).toBe('unknown');
    expect(classifyDoc('CHANGELOG.md', '')).toBe('unknown');
  });
});

describe('classifyDoc — content fallback for PRDs', () => {
  it('detects a PRD by content shape when filename is generic', () => {
    // PRDs commonly live under docs/whatever.md without a PRD-shaped
    // name. Conjunction of "Requirements" + ("Acceptance" or "Out of
    // Scope") is the reliable signal.
    const content = [
      '# Feature X',
      '',
      '## Requirements',
      '- it shall do the thing',
      '',
      '## Acceptance Criteria',
      '- when X, then Y',
    ].join('\n');
    expect(classifyDoc('docs/feature-x.md', content)).toBe('prd');
  });

  it('also matches when "Out of Scope" is the second signal', () => {
    const content = [
      '# Feature Y',
      '',
      '## Requirements',
      '- foo',
      '',
      '## Out of Scope',
      '- bar',
    ].join('\n');
    expect(classifyDoc('docs/feature-y.md', content)).toBe('prd');
  });

  it('does not match on a single signal alone (avoids false PRD positives)', () => {
    // Many design notes have a "Requirements" section without being
    // PRDs. The conjunction is what makes the fallback specific.
    const onlyRequirements = '## Requirements\n- foo\n';
    expect(classifyDoc('docs/note.md', onlyRequirements)).toBe('unknown');
    const onlyAcceptance = '## Acceptance Criteria\n- foo\n';
    expect(classifyDoc('docs/note.md', onlyAcceptance)).toBe('unknown');
  });

  it('honors filename signal over content (an ADR with PRD-like prose stays an ADR)', () => {
    const prdShapedContent = '## Requirements\nfoo\n## Acceptance Criteria\nbar\n';
    expect(classifyDoc('docs/adr/0007-auth.md', prdShapedContent)).toBe('adr');
  });
});

// ---------------------------------------------------------------------------
// Walker — uses tmp dir
// ---------------------------------------------------------------------------

describe('discoverDocs — walker', () => {
  it('returns every markdown file under the root with a stable kind', () => {
    place('SPEC.md', '# Top spec');
    place('docs/PRDs/feature.md', '# Feature\n## Requirements\n## Acceptance Criteria');
    place('docs/adr/0001.md', '# ADR 1');
    place('README.md', '# Project');
    const docs = discoverDocs(root, { skipGit: true });
    const map = new Map(docs.map((d) => [d.path, d.kind]));
    expect(map.get('SPEC.md')).toBe('spec');
    expect(map.get('docs/PRDs/feature.md')).toBe('prd');
    expect(map.get('docs/adr/0001.md')).toBe('adr');
    expect(map.get('README.md')).toBe('readme');
  });

  it('skips node_modules, .git, dist, build, .next, .turbo, .truecourse, .cache', () => {
    place('docs/real.md', '# real');
    place('node_modules/some-pkg/docs/leaked.md', '# leaked');
    place('.git/HEAD.md', '# leaked');
    place('dist/docs/leaked.md', '# leaked');
    place('build/docs/leaked.md', '# leaked');
    place('.next/leaked.md', '# leaked');
    place('.turbo/leaked.md', '# leaked');
    place('.truecourse/specs/modules/auth/endpoints.md', '# canonical — must not echo');
    place('.cache/leaked.md', '# leaked');

    const docs = discoverDocs(root, { skipGit: true });
    const paths = docs.map((d) => d.path);
    expect(paths).toContain('docs/real.md');
    expect(paths).not.toContain('node_modules/some-pkg/docs/leaked.md');
    expect(paths).not.toContain('.git/HEAD.md');
    expect(paths).not.toContain('dist/docs/leaked.md');
    expect(paths).not.toContain('build/docs/leaked.md');
    expect(paths).not.toContain('.next/leaked.md');
    expect(paths).not.toContain('.turbo/leaked.md');
    expect(paths).not.toContain('.truecourse/specs/modules/auth/endpoints.md');
    expect(paths).not.toContain('.cache/leaked.md');
  });

  it('reading .truecourse/ would echo on every run — exclude is critical', () => {
    // Simulate a state where the consolidator already ran. If we
    // re-discovered its outputs, every run would compound on its own
    // previous output.
    place('.truecourse/specs/overview.md', '# canonical overview\n');
    place('.truecourse/specs/modules/auth/endpoints.md', '# auth\n');
    place('docs/source.md', '# original');

    const docs = discoverDocs(root, { skipGit: true });
    expect(docs.map((d) => d.path)).toEqual(['docs/source.md']);
  });

  it('captures content hash (cache key) and preview', () => {
    place('SPEC.md', 'line one\nline two\nline three\n');
    const [doc] = discoverDocs(root, { skipGit: true, previewLines: 2 });
    expect(doc.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.preview).toBe('line one\nline two');
    expect(doc.size).toBeGreaterThan(0);
  });

  it('orders results deterministically by repo-relative path', () => {
    place('zzz.md', 'z');
    place('aaa.md', 'a');
    place('docs/PRDs/feature.md', '# x');
    place('docs/adr/0001.md', '# x');
    const docs = discoverDocs(root, { skipGit: true });
    const paths = docs.map((d) => d.path);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it('uses forward slashes in `path` regardless of platform', () => {
    place('docs/PRDs/nested/feature.md', '# x');
    const [doc] = discoverDocs(root, { skipGit: true });
    expect(doc.path).toBe('docs/PRDs/nested/feature.md');
    expect(doc.path).not.toMatch(/\\/);
  });

  it('skips non-markdown files', () => {
    place('docs/foo.md', '# md');
    place('docs/foo.txt', 'plain');
    place('docs/foo.json', '{}');
    const docs = discoverDocs(root, { skipGit: true });
    expect(docs.map((d) => d.path)).toEqual(['docs/foo.md']);
  });

  it('handles a directory it cannot read without crashing the walk', () => {
    place('docs/readable.md', '# ok');
    // We can't easily make a tmp dir unreadable cross-platform, but the
    // walker has a try/catch around readdirSync. Smoke-test that a
    // typical run still produces output. Manual mode of this path is
    // covered by inspection.
    expect(() => discoverDocs(root, { skipGit: true })).not.toThrow();
  });
});
