/**
 * `parseGuardStepActuals` — an evidence bundle's `invocation.json` read as the
 * ACTUAL half of a step list: one line for what the step returned, its duration, and
 * its output excerpt. Both drivers write into the same reader, and a record that says
 * nothing yields nothing rather than a guess.
 */

import { describe, it, expect } from 'vitest';
import { parseGuardStepActuals } from '@truecourse/shared';

const bundle = (steps: unknown[]) => JSON.stringify({ scenarioId: 's1', outcome: 'pass', steps });

describe('parseGuardStepActuals — the cli bundle', () => {
  it('reads exit code, duration and each stream, keyed by step position', () => {
    const actuals = parseGuardStepActuals(
      bundle([
        { index: 1, argv: ['tasks', 'init'], exitCode: 0, timedOut: false, durationMs: 12, stdout: 'ready' },
        {
          index: 2,
          argv: ['tasks', 'boom'],
          exitCode: 7,
          timedOut: false,
          durationMs: 40,
          stderr: 'fatal: intentional failure',
        },
      ]),
    );
    expect(actuals).toEqual([
      { n: 1, actual: 'exit 0', durationMs: 12, stdout: 'ready' },
      { n: 2, actual: 'exit 7', durationMs: 40, stderr: 'fatal: intentional failure' },
    ]);
  });

  it('names the ways a step can return NOTHING — killed, timed out, never spawned', () => {
    const actuals = parseGuardStepActuals(
      bundle([
        { index: 1, argv: ['a'], exitCode: null, timedOut: false, durationMs: 1 },
        { index: 2, argv: ['b'], exitCode: null, timedOut: true, durationMs: 300 },
        { index: 3, argv: ['c'], exitCode: null, timedOut: false, spawnError: 'ENOENT', durationMs: 0 },
      ]),
    );
    expect(actuals.map((a) => a.actual)).toEqual(['exit (killed)', 'timed out', 'failed to spawn: ENOENT']);
  });

  it('leaves a step that spawns nothing without an actual line', () => {
    // A `write`/`delete` moves sandbox files: no process, so no exit code. Inventing
    // one would be the record claiming something that never happened.
    const actuals = parseGuardStepActuals(
      bundle([{ index: 1, kind: 'write', argv: ['notes.txt'], exitCode: null, durationMs: 0 }]),
    );
    expect(actuals).toEqual([{ n: 1, durationMs: 0 }]);
  });

  it('omits an empty stream rather than carrying empty-string noise', () => {
    const actuals = parseGuardStepActuals(
      bundle([{ index: 1, argv: ['a'], exitCode: 0, durationMs: 5, stdout: '', stderr: '' }]),
    );
    expect(actuals[0].stdout).toBeUndefined();
    expect(actuals[0].stderr).toBeUndefined();
  });
});

describe('parseGuardStepActuals — the api bundle', () => {
  it('reads the status as the actual and the response body as the output', () => {
    const actuals = parseGuardStepActuals(
      bundle([
        { index: 1, method: 'POST', path: '/todos', status: 201, timedOut: false, durationMs: 9, body: '{"id":1}' },
        { index: 2, method: 'GET', path: '/todos/2', status: 404, timedOut: false, durationMs: 3, body: '{}' },
      ]),
    );
    expect(actuals.map((a) => a.actual)).toEqual(['status 201', 'status 404']);
    expect(actuals[0].stdout).toBe('{"id":1}');
  });

  it('reports a request that never got an answer, and a lifecycle step that returns none', () => {
    const actuals = parseGuardStepActuals(
      bundle([
        { index: 1, kind: 'boot', action: 'boot the server', status: null, durationMs: 400 },
        { index: 2, method: 'GET', path: '/x', status: null, requestError: 'ECONNREFUSED', durationMs: 12 },
      ]),
    );
    expect(actuals[0].actual).toBeUndefined();
    expect(actuals[0].durationMs).toBe(400);
    expect(actuals[1].actual).toBe('no response: ECONNREFUSED');
  });
});

describe('parseGuardStepActuals — the web bundle', () => {
  const webStep = (over: Record<string, unknown> = {}) => ({
    index: 1,
    kind: 'web',
    argv: [],
    exitCode: null,
    durationMs: 250,
    url: '/repos/sample-app',
    web: {
      command: 'click button “Security”',
      expectation: 'page text matches /Filtered by/',
      url: '/repos/sample-app',
      screenshot: 'step-1.png',
      checks: [
        {
          subject: 'text',
          expected: 'the page text contains "Filtered by"',
          actual: 'the page text was "… Filtered by: CATEGORY"',
          ok: true,
        },
      ],
      visibleText: '… Filtered by: CATEGORY',
      ...over,
    },
  });

  it('reads a web step in WEB terms — the action, the address, the picture, the page', () => {
    const actuals = parseGuardStepActuals(bundle([webStep()]));
    expect(actuals[0].web).toEqual({
      action: 'click button “Security”',
      url: '/repos/sample-app',
      screenshot: 'step-1.png',
      checks: [
        {
          subject: 'text',
          expected: 'the page text contains "Filtered by"',
          actual: 'the page text was "… Filtered by: CATEGORY"',
          ok: true,
        },
      ],
      text: '… Filtered by: CATEGORY',
    });
    // A browser step spawns nothing: it has no exit code and no streams, and the
    // reader must never be told it "printed nothing".
    expect(actuals[0].stdout).toBeUndefined();
    expect(actuals[0].stderr).toBeUndefined();
  });

  it('pairs EVERY member of the expectation with its own answer, met or not', () => {
    const actuals = parseGuardStepActuals(
      bundle([
        webStep({
          checks: [
            { subject: 'url', expected: 'the address contains "/repos"', actual: 'the address was "/repos"', ok: true },
            { subject: 'text', expected: 'the page text matches /Filtered by/', actual: 'the page text was "…"', ok: false },
          ],
        }),
      ]),
    );
    expect(actuals[0].web?.checks.map((c) => [c.subject, c.ok])).toEqual([
      ['url', true],
      ['text', false],
    ]);
  });

  it('reads a web bundle written before checks were recorded, with none', () => {
    const actuals = parseGuardStepActuals(
      bundle([
        {
          index: 1,
          kind: 'web',
          argv: [],
          durationMs: 5,
          url: '/notes',
          web: { command: 'navigate /notes', expectation: '', url: '/notes', visibleText: 'Notes' },
        },
      ]),
    );
    expect(actuals[0].web?.checks).toEqual([]);
    expect(actuals[0].actual).toBe('at /notes');
  });
});

describe('parseGuardStepActuals — anything that is not a bundle', () => {
  it('reads a bundle written before per-step output was retained', () => {
    // Older transcripts carry the invocation without the excerpts: the actual line
    // still reads, and the output is simply absent.
    const actuals = parseGuardStepActuals(bundle([{ index: 1, argv: ['a'], exitCode: 0, durationMs: 7 }]));
    expect(actuals).toEqual([{ n: 1, actual: 'exit 0', durationMs: 7 }]);
  });

  it('yields nothing for unparseable text, a foreign shape, or no steps at all', () => {
    expect(parseGuardStepActuals('not json')).toEqual([]);
    expect(parseGuardStepActuals(JSON.stringify({ steps: 'nope' }))).toEqual([]);
    expect(parseGuardStepActuals(bundle([]))).toEqual([]);
    expect(parseGuardStepActuals(null)).toEqual([]);
  });

  it('takes the parsed object as readily as its text', () => {
    expect(parseGuardStepActuals({ steps: [{ index: 1, exitCode: 0, durationMs: 2 }] })).toEqual([
      { n: 1, actual: 'exit 0', durationMs: 2 },
    ]);
  });
});
