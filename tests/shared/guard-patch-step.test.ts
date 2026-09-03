/**
 * The `patch` step — the fifth cli step kind: set or remove a named KEY PATH in a
 * JSON document, leaving everything else as found.
 *
 * What is pinned here is the FORMAT half: the shape a scenario writes, the key-path
 * grammar (dots separate keys, `\.` is a dot INSIDE a key), the closed JSON value
 * set a `set` may carry, and the one-line rendering a reader sees. The executed
 * half — missing files, unparseable documents, absent key paths — lives in
 * `tests/guard-runner/patch-step.test.ts`, because those are properties of a run.
 */

import { describe, it, expect } from 'vitest'
import {
    GuardScenarioSchema,
  GuardCliStepSchema,
  GuardPatchStepSchema,
  describeGuardScenarioSteps,
  firstInvalidMatchPattern,
  guardKeyPathSegments,
  guardKeyPathText,
  isPatchStep,
  isProcessStep,
  isWriteStep,
  stepCaptureNames,
} from '@truecourse/shared'

const BINDS = [{ doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' }]

/** A scenario whose one step patches a file the program itself created. */
const PATCH_SCENARIO = {
  id: 'break-the-build.cli.1',
  title: 'A broken build command is reported, not run',
  binds: BINDS,
  normalize: [],
  steps: [
    { run: ['init'], expect: { exit: 0 } },
    {
      patch: {
        '.relkitrc.json': {
          set: { strict: true, 'scripts.build\\.prod': 'exit 1' },
          remove: ['name'],
        },
      },
      cwd: 'repo',
      expect: { files: { 'repo/.relkitrc.json': { contains: '"strict": true' } } },
      note: 'One field of a file the test does not own.',
      milestone: ['strict-needs-a-name'],
    },
    { run: ['check'], expect: { exit: 3 } },
  ],
} as const

describe('the patch step — the shape a scenario writes', () => {
  it('parses as the fifth cli step kind, file → operations', () => {
    const parsed = GuardScenarioSchema.parse(PATCH_SCENARIO)
    const step = parsed.steps[1]
    expect(isPatchStep(step)).toBe(true)
    expect(isWriteStep(step)).toBe(false)
    // It mutates the sandbox tree; it spawns nothing, so it has no exit code.
    expect(isProcessStep(step)).toBe(false)
    expect(isPatchStep(step) && step.patch['.relkitrc.json'].remove).toEqual(['name'])
    expect(isPatchStep(step) && step.cwd).toBe('repo')
    expect(stepCaptureNames(step)).toEqual([])
  })

  it('takes any JSON value for a `set` — scalars, null, arrays, nested objects', () => {
    const step = GuardPatchStepSchema.parse({
      patch: {
        'config.json': {
          set: {
            a: 'text',
            b: 12,
            c: true,
            d: null,
            e: [1, 'two', { three: false }],
            f: { nested: { deep: [null] } },
          },
        },
      },
    })
    expect(step.patch['config.json'].set?.f).toEqual({ nested: { deep: [null] } })
  })

  it('refuses a `set` with nothing on the right — removal is explicit, never an absent value', () => {
    expect(() =>
      GuardPatchStepSchema.parse({ patch: { 'config.json': { set: { a: undefined } } } }),
    ).toThrow(/remove/)
    // …and anything that is not a JSON value at all, however deep it sits.
    expect(() =>
      GuardPatchStepSchema.parse({ patch: { 'c.json': { set: { a: { b: [new Date()] } } } } }),
    ).toThrow(/JSON value/)
    expect(() =>
      GuardPatchStepSchema.parse({ patch: { 'c.json': { set: { a: Number.POSITIVE_INFINITY } } } }),
    ).toThrow()
  })

  it('needs at least one file and at least one operation — an empty patch says nothing', () => {
    expect(() => GuardPatchStepSchema.parse({ patch: {} })).toThrow(/at least one file/)
    expect(() => GuardPatchStepSchema.parse({ patch: { 'a.json': {} } })).toThrow(/set|remove/)
    expect(() => GuardPatchStepSchema.parse({ patch: { 'a.json': { set: {}, remove: [] } } })).toThrow()
  })

  it('rejects a target that is not a JSON document — at LOAD, before a sandbox is paid for', () => {
    expect(() =>
      GuardPatchStepSchema.parse({ patch: { 'config.yaml': { remove: ['a'] } } }),
    ).toThrow(/not a JSON file/)
    // The rule is the authored suffix, so an uppercase one is still JSON.
    expect(() => GuardPatchStepSchema.parse({ patch: { 'Config.JSON': { remove: ['a'] } } })).not.toThrow()
  })

  it('is strict about its own fields', () => {
    expect(() =>
      GuardPatchStepSchema.parse({ patch: { 'a.json': { set: { x: 1 }, delete: ['y'] } } }),
    ).toThrow()
    expect(() =>
      GuardPatchStepSchema.parse({ patch: { 'a.json': { set: { x: 1 } } }, stdin: 'y' }),
    ).toThrow()
  })
})

describe('the key path — dots separate keys, `\\.` is a dot inside one', () => {
  it('splits a plain dotted path into its keys', () => {
    expect(guardKeyPathSegments('api.build.command')).toEqual({ segments: ['api', 'build', 'command'] })
    expect(guardKeyPathSegments('strict')).toEqual({ segments: ['strict'] })
  })

  it('addresses a key that CONTAINS a dot with a backslash escape', () => {
    expect(guardKeyPathSegments('scripts.build\\.prod')).toEqual({
      segments: ['scripts', 'build.prod'],
    })
    // A literal backslash is `\\`, so a key can hold one too.
    expect(guardKeyPathSegments('a\\\\b.c')).toEqual({ segments: ['a\\b', 'c'] })
  })

  it('rejects an empty segment and a dangling or unknown escape — each is a typo', () => {
    expect(guardKeyPathSegments('a..b')).toMatchObject({ error: expect.stringContaining('empty segment') })
    expect(guardKeyPathSegments('.a')).toMatchObject({ error: expect.stringContaining('empty segment') })
    expect(guardKeyPathSegments('a.')).toMatchObject({ error: expect.stringContaining('empty segment') })
    expect(guardKeyPathSegments('a\\')).toMatchObject({ error: expect.stringContaining('backslash') })
    expect(guardKeyPathSegments('a\\nb')).toMatchObject({ error: expect.stringContaining('escape') })
  })

  it('round-trips: rendering the segments back yields a path that parses to them', () => {
    for (const segments of [['a', 'b'], ['build.prod'], ['a\\b', 'c'], ['x']]) {
      expect(guardKeyPathSegments(guardKeyPathText(segments))).toEqual({ segments })
    }
  })

  it('is enforced at load — a malformed path in a step is a schema error', () => {
    expect(() => GuardPatchStepSchema.parse({ patch: { 'a.json': { set: { 'a..b': 1 } } } })).toThrow(
      /empty segment/,
    )
    expect(() => GuardPatchStepSchema.parse({ patch: { 'a.json': { remove: ['a\\'] } } })).toThrow(
      /backslash/,
    )
  })
})

describe('a patch step as a reader sees it', () => {
  it('renders as a file step naming the operations it applies', () => {
    const views = describeGuardScenarioSteps(PATCH_SCENARIO)
    expect(views[1].kind).toBe('file')
    expect(views[1].command).toBe('patch .relkitrc.json (set strict, set scripts.build\\.prod, remove name)')
    expect(views[1].cwd).toBe('repo')
    expect(views[1].expectation).toBe('repo/.relkitrc.json contains “"strict": true”')
    expect(views[1].claims).toEqual(['strict-needs-a-name'])
  })

  it('carries no regex anywhere, so the loader’s pattern check passes it by', () => {
    const step = GuardCliStepSchema.parse(PATCH_SCENARIO.steps[1])
    expect(isPatchStep(step)).toBe(true)
    expect(firstInvalidMatchPattern([step])).toBeNull()
  })
})
