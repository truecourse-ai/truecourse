/**
 * THE REQUEST STEP AS A SANDBOX STEP — the schema half of "drive the UI, then read
 * the structured answer".
 *
 * A sandbox scenario's step list is cli ∪ web ∪ `request`, and the api driver's verb
 * joins it AS ITSELF: the same schema object, the same matchers, the same capture
 * channels — not a copy that can drift. What this file pins:
 *  - the union accepts a request step and stays STRICT (an unknown key is refused,
 *    and no member of the union has two readings of one step);
 *  - only `request` joins — the lifecycle verbs (`boot`/`signal`/`logs`) drive a
 *    server process a sandbox does not hand to a step;
 *  - every cross-step pass sees it: regex validation, capture composition (both
 *    directions across surfaces), and the step-list rendering.
 */

import { describe, expect, it } from 'vitest'
import {
  GUARD_FORMAT_VERSION,
  GuardApiRequestStepSchema,
  GuardCliScenarioSchema,
  GuardSandboxStepSchema,
  captureDefects,
  describeApiCommand,
  describeGuardScenarioSteps,
  firstInvalidMatchPattern,
  isApiRequestStep,
  isWebStep,
  stepCaptureNames,
  type GuardSandboxStep,
} from '@truecourse/shared'

const binds = [{ doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' }]

function mixedScenario(steps: unknown[]): unknown {
  return { guard: GUARD_FORMAT_VERSION, id: 'f.cli.1', title: 't', binds, driver: 'cli', steps, normalize: [] }
}

describe('the request step in the sandbox union', () => {
  it('is the api driver’s own schema, accepted as a sandbox step', () => {
    const step = {
      request: { method: 'GET', path: '/api/notes?q=x' },
      expect: { status: 200, json: { total: { equals: 2 } } },
    }
    const asSandbox = GuardSandboxStepSchema.parse(step)
    const asApi = GuardApiRequestStepSchema.parse(step)
    expect(asSandbox).toEqual(asApi)
    expect(isApiRequestStep(asSandbox)).toBe(true)
    expect(isWebStep(asSandbox)).toBe(false)
  })

  it('stays STRICT — an unknown key, a bad path and a two-bodied request are refused', () => {
    expect(() =>
      GuardSandboxStepSchema.parse({
        request: { method: 'GET', path: '/x' },
        expect: { status: 200 },
        driver: 'api',
      }),
    ).toThrow()
    expect(() =>
      GuardSandboxStepSchema.parse({ request: { method: 'GET', path: 'notes' }, expect: { status: 200 } }),
    ).toThrow()
    expect(() =>
      GuardSandboxStepSchema.parse({
        request: { method: 'POST', path: '/x', body: 'a', json: { b: 1 } },
        expect: { status: 200 },
      }),
    ).toThrow()
    // No verb at all is no step: the union has nothing to route it to.
    expect(() => GuardSandboxStepSchema.parse({ expect: { status: 200 } })).toThrow()
  })

  it('the api LIFECYCLE verbs do NOT join — a sandbox owns its surface’s lifecycle', () => {
    expect(() => GuardSandboxStepSchema.parse({ boot: {} })).toThrow()
    expect(() => GuardSandboxStepSchema.parse({ signal: { name: 'SIGTERM' } })).toThrow()
    expect(() => GuardSandboxStepSchema.parse({ logs: { stream: 'stdout', match: 'ready' } })).toThrow()
  })

  it('parses as ONE step list with cli and web steps under the cli scenario schema', () => {
    const parsed = GuardCliScenarioSchema.parse(
      mixedScenario([
        { run: ['analyze'], expect: { exit: 0 } },
        { driver: 'web', click: { role: 'button', name: 'Security' }, expect: { text: { contains: 'Filtered by' } } },
        {
          request: { method: 'GET', path: '/api/repos/x/violations?severity=critical' },
          expect: { status: 200, json: { '0.ruleKey': { equals: 'no-eval' } } },
          milestone: 1,
        },
      ]),
    )
    expect(parsed.steps).toHaveLength(3)
    expect(parsed.steps.map((s) => [isWebStep(s), isApiRequestStep(s)])).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ])
  })

  it('the format version does not move — a request step is additive vocabulary', () => {
    // The `patch` and web-step precedent: the number gates BACKWARD readability, and
    // every scenario written before this parses unchanged under this build.
    expect(GUARD_FORMAT_VERSION).toBe(3)
    expect(
      GuardCliScenarioSchema.parse(mixedScenario([{ run: ['version'], expect: { exit: 0 } }])).steps,
    ).toHaveLength(1)
  })
})

describe('the cross-step passes see request steps', () => {
  it('renders one row per step, each with its own kind', () => {
    const views = describeGuardScenarioSteps(
      mixedScenario([
        { run: ['analyze'], expect: { exit: 0 } },
        { driver: 'web', navigate: '/repos/x' },
        {
          request: { method: 'GET', path: '/api/repos/x/violations?severity=critical' },
          expect: { status: 200, json: { total: { equals: 2 } } },
          repeat: 2,
          milestone: 3,
        },
      ]),
    )
    expect(views.map((v) => v.kind)).toEqual(['cli', 'web', 'api'])
    expect(views[2].command).toBe('GET /api/repos/x/violations?severity=critical')
    expect(views[2].expectation).toBe('status 200 · total is 2')
    expect(views[2].repeat).toBe(2)
    expect(views[2].milestone).toBe(3)
  })

  it('captures compose ACROSS surfaces, in both directions', () => {
    // A cli step's capture reaches a request; a request's capture reaches a web fill
    // and a later cli argv. One namespace, one order rule.
    expect(
      captureDefects([
        { run: ['analyze'], capture: { repo: { pattern: 'repo (\\S+)' } }, expect: {} },
        {
          request: { method: 'GET', path: '/api/repos/${captured:repo}/violations' },
          expect: { status: 200 },
          capture: { rule: '0.ruleKey' },
        },
        { driver: 'web', fill: { role: 'textbox', name: 'Search' }, value: '${captured:rule}' },
        { run: ['rules', 'disable', '${captured:rule}'], expect: { exit: 0 } },
      ] as GuardSandboxStep[]),
    ).toEqual([])
  })

  it('a forward reference into a request step is a defect, named', () => {
    const defects = captureDefects([
      { request: { method: 'GET', path: '/api/repos/${captured:repo}' }, expect: { status: 200 } },
      { run: ['analyze'], capture: { repo: { pattern: '(\\S+)' } }, expect: {} },
    ] as GuardSandboxStep[])
    expect(defects).toHaveLength(1)
    expect(defects[0].message).toContain('${captured:repo}')
  })

  it('a request step’s own capture names are single-assignment across the whole list', () => {
    const step = {
      request: { method: 'GET', path: '/api/notes' },
      expect: { status: 200 },
      capture: { id: 'id' },
      captureHeaders: { etag: 'ETag' },
    } as GuardSandboxStep
    expect(stepCaptureNames(step)).toEqual(['id', 'etag'])
    const defects = captureDefects([
      step,
      { run: ['show'], capture: { id: { pattern: '(\\d+)' } }, expect: {} },
    ] as GuardSandboxStep[])
    expect(defects).toHaveLength(1)
    expect(defects[0].message).toContain('already captured')
  })

  it('an uncompilable regex in a request expectation is caught before a sandbox is paid for', () => {
    const bad = firstInvalidMatchPattern([
      { run: ['version'], expect: {} },
      {
        request: { method: 'GET', path: '/api/notes' },
        expect: { status: 200, json: { total: { matches: 'a[0-9' } } },
      },
    ] as GuardSandboxStep[])
    expect(bad?.step).toBe(2)
    expect(bad?.where).toBe('expect.json.total')
  })

  it('describes the request line the same way everywhere', () => {
    expect(
      describeApiCommand(
        GuardApiRequestStepSchema.parse({
          request: { method: 'POST', path: '/api/notes' },
          expect: { status: 201 },
        }),
      ),
    ).toBe('POST /api/notes')
  })
})
