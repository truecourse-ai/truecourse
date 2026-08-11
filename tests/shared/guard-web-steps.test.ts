/**
 * The WEB step vocabulary — the schema half. A scenario carries cli steps and web
 * steps in ONE list (the sandbox is one world), the locator is closed to role +
 * accessible name, and everything the cross-step passes do for a cli step (regex
 * validation, capture composition, step rendering) they do for a web step too.
 */

import { describe, expect, it } from 'vitest'
import {
  GUARD_FORMAT_VERSION,
  GuardCliScenarioSchema,
  GuardSandboxStepSchema,
  GuardWebExpectSchema,
  GuardWebLocatorSchema,
  GuardWebStepSchema,
  captureDefects,
  describeGuardScenarioSteps,
  describeWebCommand,
  describeWebExpect,
  describeWebLocator,
  firstInvalidMatchPattern,
  isWebClickStep,
  isWebExpectStep,
  isWebFillStep,
  isWebNavigateStep,
  isWebStep,
  stepCaptureNames,
  type GuardSandboxStep,
  type GuardWebStep,
} from '@truecourse/shared'

const binds = [{ doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' }]

function mixedScenario(steps: unknown[]): unknown {
  return { guard: GUARD_FORMAT_VERSION, id: 'f.cli.1', title: 't', binds, driver: 'cli', steps, normalize: [] }
}

describe('web step schema', () => {
  it('parses the four verbs, each declaring its own driver', () => {
    const navigate = GuardWebStepSchema.parse({ driver: 'web', navigate: '/notes' })
    const click = GuardWebStepSchema.parse({ driver: 'web', click: { role: 'button', name: 'Save' } })
    const fill = GuardWebStepSchema.parse({
      driver: 'web',
      fill: { role: 'textbox', name: 'Title' },
      value: 'hello',
    })
    const check = GuardWebStepSchema.parse({ driver: 'web', expect: { text: { contains: 'Notes' } } })
    expect([
      isWebNavigateStep(navigate),
      isWebClickStep(click),
      isWebFillStep(fill),
      isWebExpectStep(check),
    ]).toEqual([true, true, true, true])
    expect(isWebStep(navigate as GuardSandboxStep)).toBe(true)
  })

  it('the step-level driver is required — an undeclared web verb is not a step', () => {
    expect(() => GuardWebStepSchema.parse({ navigate: '/notes' })).toThrow()
    expect(() => GuardSandboxStepSchema.parse({ navigate: '/notes' })).toThrow()
  })

  it('a navigate path is surface-relative — an origin is refused', () => {
    expect(() => GuardWebStepSchema.parse({ driver: 'web', navigate: 'http://localhost:3000/x' })).toThrow()
    expect(() => GuardWebStepSchema.parse({ driver: 'web', navigate: 'notes' })).toThrow()
  })

  it('the locator is closed to role + accessible name — no CSS, no unknown role', () => {
    expect(GuardWebLocatorSchema.parse({ role: 'link', name: 'Notes', exact: true }).exact).toBe(true)
    expect(() => GuardWebLocatorSchema.parse({ css: '#save' })).toThrow()
    expect(() => GuardWebLocatorSchema.parse({ role: 'button', name: 'Save', selector: '#save' })).toThrow()
    expect(() => GuardWebLocatorSchema.parse({ role: 'widget', name: 'Save' })).toThrow()
    expect(() => GuardWebLocatorSchema.parse({ role: 'button' })).toThrow()
  })

  it('a web expectation needs something to assert, and `within` needs text', () => {
    expect(() => GuardWebExpectSchema.parse({})).toThrow()
    expect(() => GuardWebExpectSchema.parse({ within: { role: 'main', name: 'Report' } })).toThrow()
    expect(
      GuardWebExpectSchema.parse({ within: { role: 'main', name: 'Report' }, text: { contains: 'ok' } }).text
        ?.contains,
    ).toBe('ok')
    expect(GuardWebExpectSchema.parse({ url: { equals: '/notes' } }).url?.equals).toBe('/notes')
    expect(GuardWebExpectSchema.parse({ visible: { role: 'heading', name: 'Notes' } }).visible?.role).toBe(
      'heading',
    )
  })

  it('an assert-only step must actually assert', () => {
    expect(() => GuardWebStepSchema.parse({ driver: 'web' })).toThrow()
  })
})

describe('a mixed cli + web scenario', () => {
  it('parses as ONE step list under the cli scenario schema', () => {
    const parsed = GuardCliScenarioSchema.parse(
      mixedScenario([
        { run: ['note', 'notes.txt', 'from the CLI'], expect: { exit: 0 } },
        { driver: 'web', navigate: '/notes', expect: { text: { contains: 'from the CLI' } }, milestone: 1 },
        { driver: 'web', click: { role: 'link', name: 'Home' }, expect: { url: { equals: '/' } } },
      ]),
    )
    expect(parsed.steps).toHaveLength(3)
    expect(isWebStep(parsed.steps[1])).toBe(true)
    expect(isWebStep(parsed.steps[0])).toBe(false)
  })

  it('renders each step with its own kind — cli rows and web rows in one list', () => {
    const views = describeGuardScenarioSteps(
      mixedScenario([
        { run: ['version'], expect: { exit: 0 } },
        { driver: 'web', navigate: '/notes', expect: { url: { equals: '/notes' } } },
        {
          driver: 'web',
          fill: { role: 'textbox', name: 'Title' },
          value: 'x',
          expect: { visible: { role: 'button', name: 'Save' } },
        },
        { driver: 'web', click: { role: 'button', name: 'Save' } },
        { driver: 'web', expect: { text: { contains: 'saved' }, within: { role: 'status', name: 'Result' } } },
      ]),
    )
    expect(views.map((v) => v.kind)).toEqual(['cli', 'web', 'web', 'web', 'web'])
    expect(views[1].command).toBe('navigate /notes')
    expect(views[1].expectation).toBe('address is “/notes”')
    expect(views[2].command).toBe('fill textbox “Title” with “x”')
    expect(views[2].expectation).toBe('button “Save” is visible')
    expect(views[3].command).toBe('click button “Save”')
    expect(views[4].command).toBe('check the page')
    expect(views[4].expectation).toBe('status “Result” text contains “saved”')
  })

  it('the format version does not move — web steps are additive runner-only vocabulary', () => {
    // The `patch` precedent, restated: the number gates BACKWARD readability, and
    // every scenario written before web steps existed parses unchanged under this
    // build. Bumping would turn away the whole committed corpus over a vocabulary
    // no committed file uses.
    expect(GUARD_FORMAT_VERSION).toBe(3)
    expect(
      GuardCliScenarioSchema.parse(mixedScenario([{ run: ['version'], expect: { exit: 0 } }])).steps,
    ).toHaveLength(1)
  })
})

describe('the cross-step passes see web steps', () => {
  it('a `${captured:…}` a web step reads must be captured by an earlier step', () => {
    const forward = captureDefects([
      { driver: 'web', navigate: '/notes/${captured:id}' },
      { run: ['show'], capture: { id: { pattern: '(\\d+)' } }, expect: {} },
    ] as GuardSandboxStep[])
    expect(forward).toHaveLength(1)
    expect(forward[0].message).toContain('${captured:id}')

    const ordered = captureDefects([
      { run: ['show'], capture: { id: { pattern: '(\\d+)' } }, expect: {} },
      { driver: 'web', navigate: '/notes/${captured:id}' },
      { driver: 'web', fill: { role: 'textbox', name: 'Q' }, value: '${captured:id}' },
      { driver: 'web', expect: { text: { contains: '${captured:id}' } } },
    ] as GuardSandboxStep[])
    expect(ordered).toEqual([])
  })

  it('a web step captures nothing', () => {
    expect(stepCaptureNames({ driver: 'web', navigate: '/' } as GuardWebStep)).toEqual([])
  })

  it('an uncompilable regex in a web expectation is caught before a browser is paid for', () => {
    const bad = firstInvalidMatchPattern([
      { run: ['version'], expect: {} },
      { driver: 'web', expect: { text: { matches: 'a[0-9' } } },
    ] as GuardSandboxStep[])
    expect(bad?.step).toBe(2)
    expect(bad?.where).toBe('expect.text')

    const badUrl = firstInvalidMatchPattern([
      { driver: 'web', navigate: '/', expect: { url: { matches: '(' } } },
    ] as GuardSandboxStep[])
    expect(badUrl?.where).toBe('expect.url')
  })
})

describe('web rendering helpers', () => {
  it('describe a locator, a command and an expectation the way a failure quotes them', () => {
    expect(describeWebLocator({ role: 'button', name: 'Save' })).toBe('button “Save”')
    expect(describeWebLocator({ role: 'button', name: 'Save', exact: true })).toBe('button “Save” (exact)')
    expect(describeWebCommand({ driver: 'web', navigate: '/a' } as GuardWebStep)).toBe('navigate /a')
    expect(describeWebExpect(undefined)).toBe('')
    expect(
      describeWebExpect({ url: { contains: '/notes' }, text: { equals: 'hi' }, visible: { role: 'main', name: 'M' } }),
    ).toBe('address contains “/notes” · page text is “hi” · main “M” is visible')
  })
})
