/**
 * The WEB step vocabulary — the schema half. A scenario carries cli steps and web
 * steps in ONE list (the sandbox is one world), the locator is closed to role +
 * accessible name, and everything the cross-step passes do for a cli step (regex
 * validation, capture composition, step rendering) they do for a web step too.
 */

import { describe, expect, it } from 'vitest'
import {
  GUARD_WEB_FILE_MAX_BYTES,
  GUARD_WEB_FILE_TYPES,
  GuardScenarioSchema,
  GuardSandboxStepSchema,
  GuardWebExpectSchema,
  GuardWebFileSchema,
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
  isWebHistoryStep,
  isWebNavigateStep,
  isWebStep,
  isWebUploadStep,
  stepCaptureNames,
  webFileType,
  webStateAssertions,
  webVisibleTargets,
  type GuardSandboxStep,
  type GuardWebStep,
} from '@truecourse/shared'

const binds = [{ doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' }]

function mixedScenario(steps: unknown[]): unknown {
  return { id: 'f.cli.1', title: 't', binds, steps, normalize: [] }
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

  it('`pick: first` is the one declared-ambiguity escape — and only `first`', () => {
    expect(GuardWebLocatorSchema.parse({ role: 'button', name: ':00', pick: 'first' }).pick).toBe('first')
    expect(GuardWebLocatorSchema.parse({ role: 'button', name: 'Save' }).pick).toBeUndefined()
    expect(() => GuardWebLocatorSchema.parse({ role: 'button', name: ':00', pick: 'last' })).toThrow()
    expect(() => GuardWebLocatorSchema.parse({ role: 'button', name: ':00', pick: 2 })).toThrow()
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

describe('the accessible-state matcher', () => {
  it('asserts an ARIA state on a role + name target', () => {
    const parsed = GuardWebExpectSchema.parse({
      state: { role: 'tab', name: 'Home', selected: true },
    })
    expect(parsed.state?.role).toBe('tab')
    expect(webStateAssertions(parsed.state!)).toEqual([{ state: 'selected', expected: true }])
  })

  it('carries several states of one element, in a fixed order', () => {
    const parsed = GuardWebExpectSchema.parse({
      state: { role: 'button', name: 'Filters', expanded: false, disabled: false, pressed: true },
    })
    expect(webStateAssertions(parsed.state!)).toEqual([
      { state: 'pressed', expected: true },
      { state: 'expanded', expected: false },
      { state: 'disabled', expected: false },
    ])
  })

  it('needs at least one state, and knows only the five', () => {
    expect(() => GuardWebExpectSchema.parse({ state: { role: 'tab', name: 'Home' } })).toThrow()
    expect(() =>
      GuardWebExpectSchema.parse({ state: { role: 'tab', name: 'Home', highlighted: true } }),
    ).toThrow()
    expect(() =>
      GuardWebExpectSchema.parse({ state: { role: 'tab', name: 'Home', selected: 'yes' } }),
    ).toThrow()
  })

  it('reads the way a failure quotes it', () => {
    expect(describeWebExpect({ state: { role: 'switch', name: 'LLM rules', checked: true } })).toBe(
      'switch “LLM rules” is checked',
    )
    expect(describeWebExpect({ state: { role: 'tab', name: 'Home', selected: false } })).toBe(
      'tab “Home” is not selected',
    )
  })
})

describe('the attribute and class matchers', () => {
  it('reads an attribute of the DOCUMENT ELEMENT when no element is named', () => {
    const parsed = GuardWebExpectSchema.parse({
      attribute: { name: 'data-theme', value: { equals: 'dark' } },
    })
    expect(parsed.attribute?.of).toBeUndefined()
    expect(describeWebExpect(parsed)).toBe('the document element’s data-theme is “dark”')
  })

  it('scopes to a role + name element with `of`', () => {
    const parsed = GuardWebExpectSchema.parse({
      attribute: { of: { role: 'button', name: 'Filters' }, name: 'data-state', value: { equals: 'open' } },
    })
    expect(parsed.attribute?.of?.name).toBe('Filters')
    expect(describeWebExpect(parsed)).toBe('button “Filters”’s data-state is “open”')
  })

  it('asserts an attribute is present or absent, whatever its value', () => {
    expect(GuardWebExpectSchema.parse({ attribute: { name: 'hidden', present: false } }).attribute?.present).toBe(
      false,
    )
    expect(describeWebExpect({ attribute: { name: 'hidden', present: false } })).toBe(
      'the document element has no hidden attribute',
    )
  })

  it('an attribute assertion must assert something', () => {
    expect(() => GuardWebExpectSchema.parse({ attribute: { name: 'class' } })).toThrow()
    expect(() => GuardWebExpectSchema.parse({ attribute: { value: { equals: 'x' } } })).toThrow()
  })

  it('a class assertion names a TOKEN — the whole point of not using `contains` on class', () => {
    const parsed = GuardWebExpectSchema.parse({ class: { has: 'dark' } })
    expect(parsed.class?.has).toBe('dark')
    expect(describeWebExpect(parsed)).toBe('the document element has class “dark”')
    expect(describeWebExpect({ class: { of: { role: 'tab', name: 'Home' }, absent: 'dark' } })).toBe(
      'tab “Home” does not have class “dark”',
    )
    expect(() => GuardWebExpectSchema.parse({ class: { of: { role: 'tab', name: 'Home' } } })).toThrow()
  })

  it('an uncompilable regex in an attribute value is caught before a browser is paid for', () => {
    const bad = firstInvalidMatchPattern([
      { driver: 'web', expect: { attribute: { name: 'class', value: { matches: 'a[0-9' } } } },
    ] as GuardSandboxStep[])
    expect(bad?.step).toBe(1)
    expect(bad?.where).toBe('expect.attribute.value')
  })
})

describe('several `visible` targets in one expectation', () => {
  it('takes a LIST as well as a single locator', () => {
    const one = GuardWebExpectSchema.parse({ visible: { role: 'button', name: 'Fit view' } })
    expect(webVisibleTargets(one.visible)).toEqual([{ role: 'button', name: 'Fit view' }])

    const many = GuardWebExpectSchema.parse({
      visible: [
        { role: 'button', name: 'Fit view' },
        { role: 'button', name: 'Zoom in' },
        { role: 'button', name: 'Zoom out' },
      ],
    })
    expect(webVisibleTargets(many.visible).map((t) => t.name)).toEqual(['Fit view', 'Zoom in', 'Zoom out'])
    expect(webVisibleTargets(undefined)).toEqual([])
  })

  it('an empty list asserts nothing and is refused', () => {
    expect(() => GuardWebExpectSchema.parse({ visible: [] })).toThrow()
  })

  it('renders every target', () => {
    expect(
      describeWebExpect({
        visible: [
          { role: 'button', name: 'Zoom in' },
          { role: 'button', name: 'Zoom out' },
        ],
      }),
    ).toBe('button “Zoom in” is visible · button “Zoom out” is visible')
  })
})

describe('the history verb', () => {
  it('parses back and forward, and only those', () => {
    const back = GuardWebStepSchema.parse({ driver: 'web', history: 'back' })
    const forward = GuardWebStepSchema.parse({ driver: 'web', history: 'forward', expect: { url: { equals: '/' } } })
    expect([isWebHistoryStep(back), isWebHistoryStep(forward)]).toEqual([true, true])
    expect(isWebExpectStep(back)).toBe(false)
    expect(() => GuardWebStepSchema.parse({ driver: 'web', history: 'reload' })).toThrow()
  })

  it('reads as a user describes it, and rides a mixed step list', () => {
    expect(describeWebCommand({ driver: 'web', history: 'back' } as GuardWebStep)).toBe('go back')
    expect(describeWebCommand({ driver: 'web', history: 'forward' } as GuardWebStep)).toBe('go forward')
    const views = describeGuardScenarioSteps(
      mixedScenario([
        { driver: 'web', navigate: '/notes' },
        { driver: 'web', history: 'back', expect: { url: { equals: '/' } } },
      ]),
    )
    expect(views.map((v) => v.kind)).toEqual(['web', 'web'])
    expect(views[1].command).toBe('go back')
    expect(views[1].expectation).toBe('address is “/”')
  })
})

describe('the upload verb', () => {
  it('parses with the locator in the verb key and the file beside it', () => {
    const step = GuardWebStepSchema.parse({
      driver: 'web',
      upload: { role: 'button', name: 'Upload Document' },
      file: { base64: 'aGk=', as: 'contract.pdf' },
      expect: { text: { contains: 'contract.pdf' } },
    })
    expect(isWebUploadStep(step)).toBe(true)
    expect(isWebUploadStep(GuardWebStepSchema.parse({ driver: 'web', navigate: '/x' }))).toBe(false)
    const upload = step as Extract<GuardWebStep, { upload: unknown }>
    expect(upload.upload.name).toBe('Upload Document')
    expect(upload.file.as).toBe('contract.pdf')
    // The whole scenario union takes it as one of its own steps.
    expect(isWebStep(GuardSandboxStepSchema.parse(step) as GuardSandboxStep)).toBe(true)
  })

  it('is NOT an assert-only step — the negation that classifies every action verb', () => {
    // `isWebExpectStep` is defined by NEGATION: a verb missing from it is read as a
    // step that takes no action, and the executor, the token pass and the step
    // rendering all silently agree to do nothing. That reads GREEN.
    const step = GuardWebStepSchema.parse({
      driver: 'web',
      upload: { role: 'button', name: 'Attach' },
      file: { text: 'hi', as: 'a.txt' },
    })
    expect(isWebExpectStep(step)).toBe(false)
    expect([isWebNavigateStep(step), isWebClickStep(step), isWebFillStep(step), isWebHistoryStep(step)]).toEqual([
      false,
      false,
      false,
      false,
    ])
  })

  it('names EXACTLY one byte source — two answers is not an answer', () => {
    expect(GuardWebFileSchema.parse({ base64: 'aGk=', as: 'a.txt' }).base64).toBe('aGk=')
    expect(GuardWebFileSchema.parse({ text: 'hi', as: 'a.txt' }).text).toBe('hi')
    expect(GuardWebFileSchema.parse({ path: 'out/report.json' }).path).toBe('out/report.json')
    expect(() => GuardWebFileSchema.parse({ base64: 'aGk=', text: 'hi', as: 'a.txt' })).toThrow()
    expect(() => GuardWebFileSchema.parse({ path: 'a.txt', text: 'hi' })).toThrow()
    expect(() => GuardWebFileSchema.parse({ as: 'a.txt' })).toThrow()
    expect(() => GuardWebFileSchema.parse({})).toThrow()
  })

  it('refuses bytes with no name — a file the app sees has a filename', () => {
    expect(() => GuardWebFileSchema.parse({ base64: 'aGk=' })).toThrow(/as/)
    expect(() => GuardWebFileSchema.parse({ text: 'hi' })).toThrow(/as/)
    // A `path` carries its own name; `as` only renames it.
    expect(GuardWebFileSchema.parse({ path: 'out/report.json' }).as).toBeUndefined()
    expect(GuardWebFileSchema.parse({ path: 'out/report.json', as: 'renamed.json' }).as).toBe('renamed.json')
  })

  it('refuses a name whose type cannot be read, and takes an explicit one', () => {
    expect(() => GuardWebFileSchema.parse({ text: 'x', as: 'thing.qqq' })).toThrow(/type/)
    expect(() => GuardWebFileSchema.parse({ text: 'x', as: 'noextension' })).toThrow(/type/)
    expect(GuardWebFileSchema.parse({ text: 'x', as: 'thing.qqq', type: 'application/x-thing' }).type).toBe(
      'application/x-thing',
    )
    expect(webFileType({ text: 'x', as: 'members.csv' })).toBe('text/csv')
    expect(webFileType({ path: 'out/report.json' })).toBe('application/json')
    expect(webFileType({ text: 'x', as: 'thing.qqq' })).toBeNull()
    expect(GUARD_WEB_FILE_TYPES.pdf).toBe('application/pdf')
    expect(GUARD_WEB_FILE_MAX_BYTES).toBe(10 * 1024 * 1024)
  })

  it('types a name that still carries its tokens — `${unique}` is inside the stem', () => {
    const file = GuardWebFileSchema.parse({ base64: 'aGk=', as: 'contract-${unique}.pdf' })
    expect(webFileType(file)).toBe('application/pdf')
    expect(webFileType({ text: 'x', as: 'report.${unique}.CSV' })).toBe('text/csv')
  })

  it('keeps the locator closed — the hidden input is not addressable, and that is the point', () => {
    expect(() =>
      GuardWebStepSchema.parse({ driver: 'web', upload: { css: '#file' }, file: { text: 'x', as: 'a.txt' } }),
    ).toThrow()
    expect(() =>
      GuardWebStepSchema.parse({
        driver: 'web',
        upload: { role: 'button', name: 'Attach', testId: 'document-upload-input' },
        file: { text: 'x', as: 'a.txt' },
      }),
    ).toThrow()
    // …and the step itself stays strict.
    expect(() =>
      GuardWebStepSchema.parse({
        driver: 'web',
        upload: { role: 'button', name: 'Attach' },
        file: { text: 'x', as: 'a.txt' },
        files: [],
      }),
    ).toThrow()
  })

  it('reads as a user describes it — the file and the control, never the bytes', () => {
    expect(
      describeWebCommand({
        driver: 'web',
        upload: { role: 'button', name: 'Upload Document' },
        file: { base64: 'c2VjcmV0LWJ5dGVz', as: 'contract-a1b2.pdf' },
      } as GuardWebStep),
    ).toBe('upload “contract-a1b2.pdf” to button “Upload Document”')
    // A `path` file is named by its BASENAME — the name the app is shown, which is
    // the only name a reader can check the page's own words against.
    expect(
      describeWebCommand({
        driver: 'web',
        upload: { role: 'button', name: 'Attach' },
        file: { path: 'out/report.json' },
      } as GuardWebStep),
    ).toBe('upload “report.json” to button “Attach”')
    expect(
      describeWebCommand({
        driver: 'web',
        upload: { role: 'button', name: 'Import members' },
        file: { text: 'email,role\nada@example.test,admin\n', as: 'members.csv' },
      } as GuardWebStep),
    ).not.toContain('ada@example.test')
  })

  it('rides a mixed step list the one scenario schema takes', () => {
    const parsed = GuardScenarioSchema.parse(
      mixedScenario([
        { run: ['note', 'notes.txt', 'seeded'], expect: { exit: 0 } },
        { driver: 'web', navigate: '/upload' },
        {
          driver: 'web',
          upload: { role: 'button', name: 'Choose a file' },
          file: { text: 'hello', as: 'hello.txt' },
          expect: { text: { contains: 'hello.txt' } },
          milestone: 1,
        },
      ]),
    )
    const views = describeGuardScenarioSteps(mixedScenario(parsed.steps))
    expect(views.map((v) => v.kind)).toEqual(['cli', 'web', 'web'])
    expect(views[2].command).toBe('upload “hello.txt” to button “Choose a file”')
    expect(views[2].expectation).toBe('page text contains “hello.txt”')
  })

  it('every corpus written before the verb parses exactly as it did', () => {
    // The verb is one more `.strict()` arm on a keyed union: nothing already
    // written changes meaning.
    const five = [
      { driver: 'web', navigate: '/notes' },
      { driver: 'web', click: { role: 'button', name: 'Save' } },
      { driver: 'web', fill: { role: 'textbox', name: 'Title' }, value: 'x' },
      { driver: 'web', history: 'back' },
      { driver: 'web', expect: { text: { contains: 'Notes' } } },
    ]
    const parsed = GuardScenarioSchema.parse(mixedScenario(five))
    expect(parsed.steps).toEqual(five)
    expect(parsed.steps.map((s) => isWebUploadStep(s as GuardWebStep))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })
})

describe('a mixed cli + web scenario', () => {
  it('parses as ONE step list under the one scenario schema', () => {
    const parsed = GuardScenarioSchema.parse(
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

  it('web steps are additive runner-only vocabulary — prior scenarios parse unchanged', () => {
    expect(
      GuardScenarioSchema.parse(mixedScenario([{ run: ['version'], expect: { exit: 0 } }])).steps,
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
    expect(describeWebLocator({ role: 'button', name: ':00', pick: 'first' })).toBe('first button “:00”')
    expect(describeWebCommand({ driver: 'web', navigate: '/a' } as GuardWebStep)).toBe('navigate /a')
    expect(describeWebExpect(undefined)).toBe('')
    expect(
      describeWebExpect({ url: { contains: '/notes' }, text: { equals: 'hi' }, visible: { role: 'main', name: 'M' } }),
    ).toBe('address contains “/notes” · page text is “hi” · main “M” is visible')
  })
})
