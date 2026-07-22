/**
 * Family escalation (item 4) — the tool-limitation notice schema + the prefilled
 * Report-issue URL both surfaces render. The URL carries only the family description,
 * member count, tool version, and target-repo name — never doc content beyond the
 * description.
 */
import { describe, it, expect } from 'vitest';
import {
  GuardFamilyEscalationSchema,
  familyIssueUrl,
} from '../../packages/shared/src/index';

const ESCALATION = {
  id: 'fam-abc123',
  description: 'Scenarios assert a weaker proxy than the claim.',
  count: 3,
  members: [
    { doc: 'docs/cli.md', anchor: 'alpha', title: 'alpha claim' },
    { doc: 'docs/cli.md', anchor: 'beta', title: 'beta claim' },
    { doc: 'docs/cli.md', anchor: 'gamma', title: 'gamma claim' },
  ],
};

describe('GuardFamilyEscalationSchema', () => {
  it('parses a well-formed escalation and rejects an empty members list', () => {
    expect(() => GuardFamilyEscalationSchema.parse(ESCALATION)).not.toThrow();
    expect(() => GuardFamilyEscalationSchema.parse({ ...ESCALATION, members: [] })).toThrow();
  });
});

describe('familyIssueUrl', () => {
  it('builds a github issues/new URL carrying the description, count, version, and repo', () => {
    const url = familyIssueUrl(ESCALATION, { version: '0.7.3', repo: 'my-project' });
    expect(url.startsWith('https://github.com/truecourse-ai/truecourse/issues/new?')).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('title')).toContain('3 claims');
    const body = params.get('body') ?? '';
    expect(body).toContain('Scenarios assert a weaker proxy than the claim.');
    expect(body).toContain('Affected claims: 3');
    expect(body).toContain('Tool version: 0.7.3');
    expect(body).toContain('Target repo: my-project');
    // No doc content beyond the description — a member's doc path never leaks in.
    expect(body).not.toContain('docs/cli.md');
    expect(body).not.toContain('alpha claim');
  });

  it('renders unknown for a missing version or repo, never an empty field', () => {
    const body = new URL(familyIssueUrl(ESCALATION, { version: '', repo: '' })).searchParams.get('body') ?? '';
    expect(body).toContain('Tool version: unknown');
    expect(body).toContain('Target repo: unknown');
  });
});
