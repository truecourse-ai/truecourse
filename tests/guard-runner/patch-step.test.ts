/**
 * The `patch` step, EXECUTED: one key path of a JSON document set or removed in the
 * sandbox, everything else left as found.
 *
 * The four ways a patch FAILS are the point of the step — a missing file, a document
 * that is not JSON, an intermediate container that is not there, and a `remove` of a
 * key path that does not exist. Each of them stops the scenario naming what it
 * looked for; none of them creates a file, invents a container, or half-applies.
 *
 * These run through `runGuard` against the fixture CLI, so what is proved is what a
 * committed scenario actually does. The pure applier is exercised beside them,
 * because its messages are the evidence a reader gets.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  runGuard,
  loadScenarios,
  patchJsonText,
  jsonSyntaxPosition,
  PatchError,
} from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** Run one committed scenario and return its result row. */
async function run(r: string, id: string) {
  const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: id })
  if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
  return res.latest.scenarios[0]
}

/** The `invocation.json` of a finished scenario's evidence bundle. */
function invocation(r: string, evidencePath: string): { steps: Record<string, unknown>[] } {
  return JSON.parse(fs.readFileSync(path.join(r, evidencePath, 'invocation.json'), 'utf-8'))
}

function transcript(r: string, evidencePath: string): string {
  return fs.readFileSync(path.join(r, evidencePath, 'transcript.txt'), 'utf-8')
}

const CONFIG = {
  name: 'demo',
  strict: false,
  scripts: { build: 'tsc', 'build.prod': 'tsc -p prod' },
  limits: { retries: 2 },
}

/** A sandbox seeded with {@link CONFIG} at `config.json`, patched by `ops`. */
function patchScenario(id: string, ops: unknown, over: Record<string, unknown> = {}) {
  return scenario({
    id,
    setup: { files: { 'config.json': `${JSON.stringify(CONFIG, null, 2)}\n` } },
    steps: [
      { patch: { 'config.json': ops } },
      { run: ['show', 'config.json'], expect: { exit: 0 } },
    ],
    ...over,
  } as never)
}

describe('a patch sets and removes named key paths', () => {
  it('sets an EXISTING key, sets a NEW final key, and removes one — nothing else moves', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'patch.yaml',
      patchScenario('patchbasics', {
        set: { strict: true, 'limits.timeoutMs': 500, 'scripts.build': 'tsc --build' },
        remove: ['name'],
      }),
    )
    const result = await run(r, 'patchbasics')
    expect(result.outcome).toBe('pass')
    const step2 = invocation(r, result.evidencePath!).steps[1] as { stdout?: string }
    const after = JSON.parse(step2.stdout!)
    expect(after).toEqual({
      strict: true,
      scripts: { build: 'tsc --build', 'build.prod': 'tsc -p prod' },
      // The new final key joined an EXISTING container; `retries` is untouched.
      limits: { retries: 2, timeoutMs: 500 },
    })
  })

  it('addresses a key that contains a dot through the `\\.` escape', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'escaped.yaml',
      patchScenario('patchescaped', { set: { 'scripts.build\\.prod': 'tsc -p release' } }),
    )
    const result = await run(r, 'patchescaped')
    expect(result.outcome).toBe('pass')
    const step2 = invocation(r, result.evidencePath!).steps[1] as { stdout?: string }
    const after = JSON.parse(step2.stdout!)
    expect(after.scripts).toEqual({ build: 'tsc', 'build.prod': 'tsc -p release' })
  })

  it('normalizes formatting — 2-space indent and a trailing newline, never byte preservation', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'format.yaml',
      scenario({
        id: 'patchformat',
        // Authored on one line with 4-space-ish noise; the patch re-serializes it.
        setup: { files: { 'config.json': '{"a":{"b":1},   "c":  2}' } },
        steps: [
          { patch: { 'config.json': { set: { c: 3 } } } },
          {
            run: ['show', 'config.json'],
            expect: { exit: 0, stdout: { equals: '{\n  "a": {\n    "b": 1\n  },\n  "c": 3\n}\n' } },
          },
        ],
      }),
    )
    expect((await run(r, 'patchformat')).outcome).toBe('pass')
  })

  it('resolves against the step’s cwd, while `expect.files` stays sandbox-relative', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cwd.yaml',
      scenario({
        id: 'patchcwd',
        setup: { files: { 'sub/config.json': '{"strict": false}\n', 'config.json': '{"strict": false}\n' } },
        steps: [
          {
            patch: { 'config.json': { set: { strict: true } } },
            cwd: 'sub',
            // Sandbox-relative both ways: the patched file is the one under `sub/`,
            // and its sibling at the root is untouched.
            expect: {
              files: {
                'sub/config.json': { contains: '"strict": true' },
                'config.json': { contains: '"strict": false' },
              },
            },
          },
        ],
      }),
    )
    expect((await run(r, 'patchcwd')).outcome).toBe('pass')
  })

  it('refuses a target that escapes the sandbox', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'escape.yaml',
      scenario({
        id: 'patchescape',
        steps: [{ patch: { '../outside.json': { set: { a: 1 } } } }],
      } as never),
    )
    const result = await run(r, 'patchescape')
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain('escapes the sandbox')
  })
})

describe('a patch that cannot be addressed is refused at LOAD', () => {
  it('names the non-JSON target, before a sandbox is ever built', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'yamltarget.yaml',
      scenario({ id: 'patchyaml', steps: [{ patch: { 'config.yaml': { remove: ['a'] } } }] } as never),
    )
    const { errors } = loadScenarios(r)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('"config.yaml" is not a JSON file')
  })

  it('names a malformed key path, with the file it belongs to', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'badpath.yaml',
      scenario({
        id: 'patchbadpath',
        steps: [{ patch: { 'config.json': { set: { 'a..b': 1 } } } }],
      } as never),
    )
    const { errors } = loadScenarios(r)
    expect(errors[0].message).toContain('patch.config.json')
    expect(errors[0].message).toContain('key path "a..b" has an empty segment')
  })
})

describe('a patch that cannot mean what it says stops the scenario', () => {
  it('a MISSING file is the step failing — never a silent create', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'missing.yaml',
      scenario({
        id: 'patchmissing',
        steps: [
          { patch: { 'nope.json': { set: { a: 1 } } } },
          { run: [], expect: { exit: 0 } },
        ],
      } as never),
    )
    const result = await run(r, 'patchmissing')
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain('nope.json does not exist')
    // The step did not create it on the way past.
    expect(transcript(r, result.evidencePath!)).not.toContain('step 2')
  })

  it('an UNPARSEABLE document fails naming the position the parser stopped at', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'broken.yaml',
      scenario({
        id: 'patchbroken',
        setup: { files: { 'config.json': '{"a": 1,\n  "b": }\n' } },
        steps: [{ patch: { 'config.json': { set: { a: 2 } } } }],
      } as never),
    )
    const result = await run(r, 'patchbroken')
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain(
      'config.json is not valid JSON at line 2, column 8 (position 16)',
    )
  })

  it('a MISSING INTERMEDIATE fails naming the deepest key path that does exist', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'gap.yaml', patchScenario('patchgap', { set: { 'limits.retry.maxMs': 10 } }))
    const result = await run(r, 'patchgap')
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain('the deepest key path that exists is "limits"')
    expect(result.failure?.actual).toContain('never creates')
    // And the document was left exactly as it was found.
    expect(transcript(r, result.evidencePath!)).not.toContain('step 2')
  })

  it('a REMOVE of an absent key path fails, deepest existing key named', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'ghost.yaml', patchScenario('patchghost', { remove: ['limits.backoff'] }))
    const result = await run(r, 'patchghost')
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain('does not exist')
    expect(result.failure?.actual).toContain('the deepest key path that exists is "limits"')
  })

  it('indexing THROUGH a non-object fails naming the type that is actually there', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'type.yaml', patchScenario('patchtype', { set: { 'name.first': 'x' } }))
    const result = await run(r, 'patchtype')
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain('"name" is a string, not an object')
  })

  it('applies NOTHING when any operation of the step fails — no partial patch', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'atomic.yaml',
      scenario({
        id: 'patchatomic',
        setup: {
          files: {
            'a.json': '{"keep": 1}\n',
            'b.json': '{"keep": 2}\n',
          },
        },
        steps: [
          {
            patch: {
              // The first file's operations are all valid; the second file's are not.
              'a.json': { set: { keep: 99 } },
              'b.json': { set: { 'gone.deeper': 1 } },
            },
          },
        ],
      } as never),
    )
    const result = await run(r, 'patchatomic')
    expect(result.outcome).toBe('error')
    // `a.json` was computed but never written: a step is one edit or none.
    expect(result.failure?.actual).toContain('the deepest key path that exists is the document root')
  })
})

describe('tokens resolve in the file path and in set values', () => {
  it('substitutes `${sandbox}` and `${captured:…}` in both positions', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'tokens.yaml',
      scenario({
        id: 'patchtokens',
        setup: { files: { 'deep/config.json': '{"who": "nobody", "nested": {"at": ""}}\n' } },
        steps: [
          {
            run: ['--version'],
            expect: { exit: 0 },
            capture: { who: { pattern: '^([0-9.]+)' } },
          },
          {
            // A token in the PATH…
            patch: {
              '${sandbox}/deep/config.json': {
                // …and in a value, including one nested inside an object value.
                set: { who: '${captured:who}', nested: { at: '${sandbox}/deep' } },
              },
            },
          },
          {
            run: ['show', 'deep/config.json'],
            expect: { exit: 0, stdout: { matches: '"who": "2\\.4\\.1"' } },
          },
        ],
      } as never),
    )
    const result = await run(r, 'patchtokens')
    expect(result.outcome).toBe('pass')
    const step3 = invocation(r, result.evidencePath!).steps[2] as { stdout?: string }
    const after = JSON.parse(step3.stdout!)
    expect(after.who).toBe('2.4.1')
    expect(after.nested.at).toMatch(/^\/.*\/deep$/)
    expect(after.nested.at).not.toContain('${sandbox}')
  })
})

describe('the transcript records the patch as authored', () => {
  it('names the file and every operation, tokens resolved', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'evidence.yaml',
      patchScenario('patchevidence', { set: { strict: true }, remove: ['name'] }),
    )
    const result = await run(r, 'patchevidence')
    expect(result.outcome).toBe('pass')
    const step = invocation(r, result.evidencePath!).steps[0]
    expect(step).toMatchObject({
      kind: 'patch',
      argv: ['config.json'],
      patch: [
        { file: 'config.json', op: 'set', path: 'strict', value: 'true' },
        { file: 'config.json', op: 'remove', path: 'name' },
      ],
    })
    const text = transcript(r, result.evidencePath!)
    expect(text).toContain('patch:')
    expect(text).toContain('set:     config.json strict = true')
    expect(text).toContain('remove:  config.json name')
  })

  it('a failing patch leaves the reason in the transcript beside the operations', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'gapev.yaml', patchScenario('patchgapev', { set: { 'limits.retry.maxMs': 10 } }))
    const result = await run(r, 'patchgapev')
    expect(result.outcome).toBe('error')
    const text = transcript(r, result.evidencePath!)
    expect(text).toContain('set:     config.json limits.retry.maxMs = 10')
    expect(text).toContain('── error (step 1)')
    expect(text).toContain('the deepest key path that exists is "limits"')
    // The same sentence is the bundle's diff, which is what a reader opens first.
    expect(fs.readFileSync(path.join(r, result.evidencePath!, 'diff.txt'), 'utf-8')).toContain(
      'the deepest key path that exists is "limits"',
    )
  })
})

describe('patchJsonText — the applier, in isolation', () => {
  const text = `${JSON.stringify(CONFIG, null, 2)}\n`

  it('re-serializes with 2-space indent and a trailing newline', () => {
    const out = patchJsonText({ file: 'c.json', text: '{"a":1}', set: { b: 2 } })
    expect(out).toBe('{\n  "a": 1,\n  "b": 2\n}\n')
  })

  it('applies every `set` before every `remove`, each in declaration order', () => {
    const out = patchJsonText({
      file: 'c.json',
      text,
      set: { strict: true },
      remove: ['name', 'limits'],
    })
    expect(JSON.parse(out)).toEqual({
      strict: true,
      scripts: { build: 'tsc', 'build.prod': 'tsc -p prod' },
    })
  })

  it('writes every key as an OWN field — `__proto__` cannot become a silent no-op', () => {
    // A computed key, because `{ __proto__: … }` in a literal is the prototype
    // setter — the very confusion the applier defends against.
    const out = patchJsonText({ file: 'c.json', text: '{"a": 1}', set: { ['__proto__']: 'x' } })
    expect(out).toContain('"__proto__": "x"')
    const parsed = JSON.parse(out) as Record<string, unknown>
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true)
    expect(parsed['__proto__']).toBe('x')
  })

  it('refuses a document whose ROOT is not an object', () => {
    expect(() => patchJsonText({ file: 'c.json', text: '[1,2]', set: { a: 1 } })).toThrow(PatchError)
    expect(() => patchJsonText({ file: 'c.json', text: '[1,2]', set: { a: 1 } })).toThrow(
      /is an array, not an object/,
    )
  })

  it('names the deepest existing key path when an intermediate is absent', () => {
    expect(() => patchJsonText({ file: 'c.json', text, set: { 'a.b.c': 1 } })).toThrow(
      /the deepest key path that exists is the document root/,
    )
    expect(() => patchJsonText({ file: 'c.json', text, set: { 'limits.a.b': 1 } })).toThrow(
      /the deepest key path that exists is "limits"/,
    )
  })

  it('names the type that blocked a key path, whatever it is', () => {
    expect(() => patchJsonText({ file: 'c.json', text, set: { 'limits.retries.deep': 1 } })).toThrow(
      /"limits\.retries" is a number, not an object/,
    )
    expect(() =>
      patchJsonText({ file: 'c.json', text: '{"a": [1]}', remove: ['a.0'] }),
    ).toThrow(/"a" is an array, not an object/)
    expect(() =>
      patchJsonText({ file: 'c.json', text: '{"a": null}', set: { 'a.b': 1 } }),
    ).toThrow(/"a" is null, not an object/)
  })

  it('reports a dotted key by its ESCAPED form, so the message can be pasted back', () => {
    expect(() =>
      patchJsonText({ file: 'c.json', text, set: { 'scripts.build\\.prod.deep': 1 } }),
    ).toThrow(/"scripts\.build\\\.prod" is a string, not an object/)
  })
})

describe('jsonSyntaxPosition — where a document stops being JSON', () => {
  it('says nothing about a document that parses', () => {
    for (const ok of ['{}', '[]', '  {"a": [1, -2.5e+3, true, false, null, "\\u00e9\\n"]}  ', '"x"', '0']) {
      expect(jsonSyntaxPosition(ok)).toBeNull()
    }
  })

  it('locates every class of defect, at the offset the reader must look at', () => {
    // The offset is the SAME whatever the runtime says: V8 names a position for
    // some of these and quotes a window of the source for the rest.
    expect(jsonSyntaxPosition('{"a": 1,\n  "b": }\n')).toEqual({ position: 16, line: 2, column: 8 })
    expect(jsonSyntaxPosition('{"a": 1,}')).toEqual({ position: 8, line: 1, column: 9 })
    expect(jsonSyntaxPosition('{')).toEqual({ position: 1, line: 1, column: 2 })
    expect(jsonSyntaxPosition('{"a": 01}')).toEqual({ position: 7, line: 1, column: 8 })
    expect(jsonSyntaxPosition('{"a": "un\\xterminated"}')).toEqual({ position: 10, line: 1, column: 11 })
    expect(jsonSyntaxPosition('{"a": 1} trailing')).toEqual({ position: 9, line: 1, column: 10 })
    expect(jsonSyntaxPosition('not json at all')).toEqual({ position: 0, line: 1, column: 1 })
  })

  it('agrees with the parser on every fixture: it fails exactly when JSON.parse does', () => {
    const samples = [
      '{}',
      '{"a": {"b": [1, 2, {"c": null}]}}',
      '[]',
      '[1,2,3]',
      '"text"',
      '-0.5e-3',
      'true',
      '{"a": 1,}',
      '{"a": }',
      "{'a': 1}",
      '{"a" 1}',
      '[1,]',
      '{"a": 1',
      '',
      '  ',
      '{"a": tru}',
      '{"a": "x" "b": 2}',
    ]
    for (const sample of samples) {
      let parses = true
      try {
        JSON.parse(sample)
      } catch {
        parses = false
      }
      expect([sample, jsonSyntaxPosition(sample) === null]).toEqual([sample, parses])
    }
  })
})
