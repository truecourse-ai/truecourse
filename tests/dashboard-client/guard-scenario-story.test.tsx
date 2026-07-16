/**
 * The plain-words scenario STORY: the shared `GuardScenarioStory` component
 * (Doc says → Setup → Run → Expect, claim line dropped when absent) and its wiring
 * into the Scenarios-tab detail pane, where the parsed source drives the story and
 * the raw YAML rides behind a toggle.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuardScenario } from '@truecourse/shared';
import { GuardScenarioStory } from '@/components/guard/GuardScenarioStory';
import { GuardScenarioDetail } from '@/components/guard/GuardScenarioDetail';
import type { GuardScenarioRowData } from '@/hooks/useGuardScenarios';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

function scenario(over: Partial<GuardScenario> = {}): GuardScenario {
  return {
    guard: 1,
    id: 'fix.1',
    title: 'fix rewrites the file in place',
    claim: 'Running fix on a fixable file rewrites it in place.',
    binds: { doc: 'docs/cli.md', section: 'fix', fingerprint: 'sha256:x' },
    driver: 'cli',
    setup: { files: { 'test.sql': 'select 1' } },
    steps: [{ run: ['fix', 'test.sql'], expect: { exit: 0, stdout: { contains: 'SELECT 1' } } }],
    normalize: [],
    ...over,
  };
}

describe('GuardScenarioStory', () => {
  it('renders Doc says (claim + heading), Setup, Run, and Expect', () => {
    render(<GuardScenarioStory scenario={scenario()} headingText="Fixing files" />);
    expect(screen.getByText('Doc says')).toBeInTheDocument();
    expect(screen.getByText('Running fix on a fixable file rewrites it in place.')).toBeInTheDocument();
    expect(screen.getByText('§ Fixing files')).toBeInTheDocument();
    expect(screen.getByText('Setup')).toBeInTheDocument();
    expect(screen.getByText('test.sql')).toBeInTheDocument();
    expect(screen.getByText('Run')).toBeInTheDocument();
    expect(screen.getByText('fix test.sql')).toBeInTheDocument();
    expect(screen.getByText('Expect')).toBeInTheDocument();
    expect(screen.getByText('exit code is 0')).toBeInTheDocument();
    expect(screen.getByText('stdout contains "SELECT 1"')).toBeInTheDocument();
  });

  it('drops the claim line for a scenario with no stored claim (no placeholder noise)', () => {
    const { claim: _claim, ...rest } = scenario();
    render(<GuardScenarioStory scenario={rest as GuardScenario} headingText="Fixing files" />);
    // The claim text is gone…
    expect(screen.queryByText('Running fix on a fixable file rewrites it in place.')).not.toBeInTheDocument();
    // …but the section heading and mechanics still render.
    expect(screen.getByText('§ Fixing files')).toBeInTheDocument();
    expect(screen.getByText('fix test.sql')).toBeInTheDocument();
    expect(screen.getByText('exit code is 0')).toBeInTheDocument();
  });
});

describe('GuardScenarioDetail — story from the parsed source, raw YAML behind a toggle', () => {
  afterEach(() => vi.unstubAllGlobals());

  const row: GuardScenarioRowData = {
    id: 'fix.1',
    title: 'fix rewrites the file in place',
    doc: 'docs/cli.md',
    anchor: 'fix',
    headingText: 'Fixing files',
    file: 'core/fix.1.yaml',
    handWritten: false,
    lastResult: null,
  };

  it('renders the story and reveals the raw YAML only after the toggle', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/scenario?')) {
          return json({ id: 'fix.1', file: 'core/fix.1.yaml', content: 'guard: 1\nid: fix.1\nclaim: RAW-YAML-MARKER', scenario: scenario() });
        }
        return json({});
      }),
    );

    render(<GuardScenarioDetail repoId="r" row={row} runId={null} onClose={() => {}} onOpenSpec={() => {}} />);

    // The story renders from the parsed scenario.
    expect(await screen.findByText('Running fix on a fixable file rewrites it in place.')).toBeInTheDocument();
    expect(screen.getByText('exit code is 0')).toBeInTheDocument();

    // Raw YAML is behind the toggle — not present until it's opened.
    expect(screen.queryByText(/RAW-YAML-MARKER/)).not.toBeInTheDocument();
    await user.click(screen.getByText('View YAML source'));
    expect(screen.getByLabelText('scenario source')).toHaveTextContent('RAW-YAML-MARKER');
  });
});
