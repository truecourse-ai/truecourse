import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  gatherCandidates,
  proposeWithHeuristic,
} from '../../packages/contract-extractor/src/bootstrap.js';

describe('bootstrap heuristic', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-boot-'));
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function place(rel: string, body: string = '# x\n'): void {
    const full = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }

  it('flags SPEC.md as a base spec', () => {
    place('SPEC.md');
    const candidates = gatherCandidates(tmpRoot);
    const spec = candidates.find((c) => c.file === 'SPEC.md');
    expect(spec?.kind).toBe('base-spec');
  });

  it('treats files under docs/adr/ as ADR series', () => {
    place('docs/adr/0001-thing.md');
    const candidates = gatherCandidates(tmpRoot);
    expect(candidates.some((c) => c.kind === 'adr-series')).toBe(true);
  });

  it('treats RFCs under docs/rfc/ as rfc kind', () => {
    place('docs/rfc/2026-q1.md');
    const candidates = gatherCandidates(tmpRoot);
    expect(candidates.some((c) => c.kind === 'rfc')).toBe(true);
  });

  it('excludes README and CHANGELOG by default', () => {
    place('README.md');
    place('CHANGELOG.md');
    const candidates = gatherCandidates(tmpRoot);
    expect(candidates.some((c) => c.file === 'CHANGELOG.md')).toBe(false);
    const readme = candidates.find((c) => c.file === 'README.md');
    expect(readme?.kind).toBe('overview');
  });

  it('proposes ranks 0 / 1 / 2 in the heuristic ordering', () => {
    place('SPEC.md');
    place('docs/adr/0001-foo.md');
    place('docs/adr/0002-bar.md');
    place('docs/rfc/2026-q1.md');

    const candidates = gatherCandidates(tmpRoot);
    const proposal = proposeWithHeuristic(candidates);

    const byRank = new Map(proposal.config.specs.map((s) => [s.rank, s.file]));
    expect(byRank.get(0)).toBe('SPEC.md');
    expect(byRank.get(2)).toContain('rfc');
    // Multiple ADRs in the same dir collapse to a glob.
    expect(proposal.config.specs.some((s) => s.rank === 1 && s.file.includes('*.md'))).toBe(true);
  });

  it('skips node_modules and dot directories', () => {
    place('node_modules/foo/SPEC.md');
    place('.cache/SPEC.md');
    const candidates = gatherCandidates(tmpRoot);
    expect(candidates).toEqual([]);
  });
});
