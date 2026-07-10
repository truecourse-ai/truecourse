/**
 * Guard-gate Check output: title/summary per conclusion (an internal 'error'
 * renders as an error-styled FAILURE), the kill-switch env, the 50-annotation
 * cap, and postCheck's widened conclusion + annotations pass-through.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  GUARD_GATE_CHECK_NAME,
  GATE_CHECK_NAME,
  GUARD_GATE_KILL_SWITCH_ENV,
  GUARD_GATE_MAX_ANNOTATIONS,
  guardGateCheckOutput,
  guardGateDisabled,
  guardGateDisabledOutput,
  capGuardAnnotations,
  type GuardGateDecision,
  type GuardGateDiff,
  type GuardStaleAnnotation,
} from '../../ee/packages/github-app/src/index';
import { postCheck } from '../../ee/packages/github-app/src/octokit';
import type { GuardScenarioResult } from '@truecourse/shared';

function scen(id: string, outcome: GuardScenarioResult['outcome']): GuardScenarioResult {
  return {
    id,
    title: `claim ${id}`,
    binds: { doc: 'docs/spec.md', section: `sec-${id}`, fingerprint: 'sha256:fp' },
    outcome,
    durationMs: 5,
  };
}

function diff(over: Partial<GuardGateDiff> = {}): GuardGateDiff {
  return { newlyFailing: [], preExisting: [], resolved: [], stale: [], excluded: [], ...over };
}

function annotation(i: number): GuardStaleAnnotation {
  return {
    path: 'docs/spec.md',
    start_line: i,
    end_line: i,
    annotation_level: 'warning',
    title: `stale ${i}`,
    message: 'section edited since the scenario was written',
  };
}

describe('guardGateCheckOutput', () => {
  it('the guard gate posts under the same Check name as the drift gate', () => {
    expect(GUARD_GATE_CHECK_NAME).toBe(GATE_CHECK_NAME);
    expect(GUARD_GATE_CHECK_NAME).toBe('TrueCourse / drift');
  });

  it('success reads cleanly and counts resolved scenarios', () => {
    const d: GuardGateDecision = {
      conclusion: 'success',
      diff: diff({ resolved: [scen('a', 'pass')] }),
    };
    const out = guardGateCheckOutput(d);
    expect(out.title).toBe('No newly failing guard scenarios');
    expect(out.summary).toContain('1 resolved');
  });

  it('success notes pre-existing failures without failing on them', () => {
    const d: GuardGateDecision = {
      conclusion: 'success',
      diff: diff({ preExisting: [scen('b', 'fail')] }),
    };
    const out = guardGateCheckOutput(d);
    expect(out.title).toBe('No newly failing guard scenarios');
    expect(out.summary).toContain('1 pre-existing failure');
  });

  it('failure lists the newly failing scenarios with their doc anchors', () => {
    const d: GuardGateDecision = {
      conclusion: 'failure',
      diff: diff({ newlyFailing: [scen('a', 'fail'), scen('b', 'error')] }),
    };
    const out = guardGateCheckOutput(d);
    expect(out.title).toBe('2 newly failing guard scenarios');
    expect(out.summary).toContain('claim a');
    expect(out.summary).toContain('docs/spec.md#sec-a');
    expect(out.summary).toContain('claim b');
  });

  it('a singular newly failing scenario titles without the plural s', () => {
    const d: GuardGateDecision = {
      conclusion: 'failure',
      diff: diff({ newlyFailing: [scen('a', 'fail')] }),
    };
    expect(guardGateCheckOutput(d).title).toBe('1 newly failing guard scenario');
  });

  it('advisory (neutral with newly failing) frames the list as non-blocking', () => {
    const d: GuardGateDecision = {
      conclusion: 'neutral',
      diff: diff({ newlyFailing: [scen('a', 'fail')] }),
    };
    const out = guardGateCheckOutput(d);
    expect(out.title).toBe('1 newly failing guard scenario');
    expect(out.summary.toLowerCase()).toContain('advisory');
  });

  it('neutral no-scenarios explains there is nothing to run', () => {
    const d: GuardGateDecision = { conclusion: 'neutral', diff: diff(), neutralReason: 'no-scenarios' };
    const out = guardGateCheckOutput(d);
    expect(out.title).toBe('No guard scenarios to run');
    expect(out.summary).toContain('no committed guard scenarios');
  });

  it('neutral no-baseline explains the baseline is not established', () => {
    const d: GuardGateDecision = { conclusion: 'neutral', diff: diff(), neutralReason: 'no-baseline' };
    const out = guardGateCheckOutput(d);
    expect(out.title).toBe('Baseline not established');
    expect(out.summary).toContain('default branch');
  });

  it.each([
    ['build-failed', 'Gate error — build failed (no verdict)'],
    ['build-timed-out', 'Gate error — build timed out (no verdict)'],
    ['entry-preflight', 'Gate error — built entry failed to start (no verdict)'],
    ['run-timed-out', 'Gate error — run timed out (no verdict)'],
    ['aborted', 'Gate error — run aborted (no verdict)'],
    ['infra', 'Gate error — gate infrastructure failed (no verdict)'],
  ] as const)('error %s renders an error-styled failure title', (errorReason, title) => {
    const d: GuardGateDecision = { conclusion: 'error', diff: diff(), errorReason };
    const out = guardGateCheckOutput(d);
    expect(out.title).toBe(title);
    expect(out.summary).toContain('no verdict');
  });
});

describe('capGuardAnnotations', () => {
  it('caps at the GitHub per-request limit of 50', () => {
    expect(GUARD_GATE_MAX_ANNOTATIONS).toBe(50);
    const many = Array.from({ length: 60 }, (_, i) => annotation(i + 1));
    const capped = capGuardAnnotations(many);
    expect(capped).toHaveLength(50);
    expect(capped[0].start_line).toBe(1);
    expect(capped[49].start_line).toBe(50);
  });

  it('leaves a short list untouched', () => {
    const few = [annotation(1), annotation(2)];
    expect(capGuardAnnotations(few)).toEqual(few);
  });
});

describe('guardGateDisabled', () => {
  const saved = process.env[GUARD_GATE_KILL_SWITCH_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[GUARD_GATE_KILL_SWITCH_ENV];
    else process.env[GUARD_GATE_KILL_SWITCH_ENV] = saved;
  });

  it('exposes the documented env name', () => {
    expect(GUARD_GATE_KILL_SWITCH_ENV).toBe('TRUECOURSE_GUARD_GATE_DISABLED');
  });

  it('is off when the env is unset or empty', () => {
    delete process.env[GUARD_GATE_KILL_SWITCH_ENV];
    expect(guardGateDisabled()).toBe(false);
    process.env[GUARD_GATE_KILL_SWITCH_ENV] = '';
    expect(guardGateDisabled()).toBe(false);
  });

  it('is on for a truthy value', () => {
    process.env[GUARD_GATE_KILL_SWITCH_ENV] = '1';
    expect(guardGateDisabled()).toBe(true);
    process.env[GUARD_GATE_KILL_SWITCH_ENV] = 'true';
    expect(guardGateDisabled()).toBe(true);
  });

  it("treats '0' and 'false' as off", () => {
    process.env[GUARD_GATE_KILL_SWITCH_ENV] = '0';
    expect(guardGateDisabled()).toBe(false);
    process.env[GUARD_GATE_KILL_SWITCH_ENV] = 'false';
    expect(guardGateDisabled()).toBe(false);
  });

  it('the disabled output names the kill switch', () => {
    const out = guardGateDisabledOutput();
    expect(out.title).toBe('Guard gate disabled');
    expect(out.summary).toContain('TRUECOURSE_GUARD_GATE_DISABLED');
  });
});

describe('postCheck (widened)', () => {
  function makeChecks() {
    const calls = { create: [] as any[], update: [] as any[] };
    const octokit: any = {
      checks: {
        create: async (p: any) => {
          calls.create.push(p);
          return { data: { id: 1 } };
        },
        update: async (p: any) => {
          calls.update.push(p);
          return { data: { id: p.check_run_id } };
        },
      },
    };
    return { octokit, calls };
  }

  it('passes annotations and a widened conclusion through on create', async () => {
    const { octokit, calls } = makeChecks();
    const annotations = [annotation(3)];
    await postCheck(octokit, { owner: 'acme', repo: 'api' }, 'TrueCourse / drift', 'headsha', 'timed_out', {
      title: 't',
      summary: 's',
      annotations,
    });
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].conclusion).toBe('timed_out');
    expect(calls.create[0].output.annotations).toEqual(annotations);
  });

  it('passes annotations through when completing an in-progress run', async () => {
    const { octokit, calls } = makeChecks();
    const annotations = [annotation(7)];
    await postCheck(octokit, { owner: 'acme', repo: 'api' }, 'TrueCourse / drift', 'headsha', 'action_required', {
      title: 't',
      summary: 's',
      annotations,
    }, 42);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].check_run_id).toBe(42);
    expect(calls.update[0].conclusion).toBe('action_required');
    expect(calls.update[0].output.annotations).toEqual(annotations);
  });

  it('existing callers without annotations still work', async () => {
    const { octokit, calls } = makeChecks();
    await postCheck(octokit, { owner: 'acme', repo: 'api' }, 'TrueCourse / drift', 'headsha', 'success', {
      title: 't',
      summary: 's',
    });
    expect(calls.create[0].output.annotations).toBeUndefined();
  });
});
