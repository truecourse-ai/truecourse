import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  INTERFACE_UNKNOWN,
  InterfaceContractSchema,
  InterfaceOptionSchema,
  InterfacePromptFactSchema,
  InterfacePromptSubmitSchema,
  InterfaceReadFactSchema,
  InterfaceRowFactSchema,
  InterfaceRowRoleSchema,
  InterfaceSchema,
  InterfaceSequenceSchema,
  InterfaceSlotKindSchema,
  InterfaceStateIdSchema,
  InterfaceStateSchema,
  InterfaceStepSchema,
  InterfaceStepKindSchema,
  InterfacesFileSchema,
  canonicalRoutePath,
  interfaceEntryLabel,
  interfaceFingerprint,
  guardDriverIds,
  type Interface,
  type InterfaceCommandContract,
  type InterfaceContract,
  type InterfaceSequenceNode,
  type InterfaceStep,
} from '@truecourse/shared'

function iface(steps: InterfaceStep[], over: Partial<Interface> = {}): Interface {
  const base = {
    id: 'cli/tasks-add',
    type: 'cli' as const,
    title: 'tasks add',
    entry: { command: ['tasks', 'add'] },
    steps,
    ...over,
  }
  return { ...base, fingerprint: interfaceFingerprint(base) }
}

const INVOKE: InterfaceStep = { kind: 'invoke', command: ['tasks', 'add'], flags: ['--json', '--force'] }
const REQUEST: InterfaceStep = { kind: 'request', method: 'POST', path: '/tasks' }
const NAVIGATE: InterfaceStep = { kind: 'navigate', route: '/board' }
const INPUT: InterfaceStep = { kind: 'input', target: 'TaskBoard::titleField' }
const ACTIVATE: InterfaceStep = { kind: 'activate', target: 'TaskBoard::addButton' }

describe('interface schemas', () => {
  it('the step vocabulary is the closed five-kind set', () => {
    expect(InterfaceStepKindSchema.options).toEqual(['invoke', 'request', 'navigate', 'input', 'activate'])
  })

  it('parses every step kind', () => {
    for (const step of [INVOKE, REQUEST, NAVIGATE, INPUT, ACTIVATE]) {
      expect(() => InterfaceStepSchema.parse(step)).not.toThrow()
    }
  })

  it('rejects an unknown kind and a payload from the wrong kind', () => {
    expect(() => InterfaceStepSchema.parse({ kind: 'scroll', target: 'x' })).toThrow()
    expect(() => InterfaceStepSchema.parse({ kind: 'navigate', target: 'x' })).toThrow()
    expect(() => InterfaceStepSchema.parse({ kind: 'request', method: 'GET' })).toThrow()
  })

  it('defaults invoke flags to []', () => {
    expect(InterfaceStepSchema.parse({ kind: 'invoke', command: ['tasks'] })).toEqual({
      kind: 'invoke',
      command: ['tasks'],
      flags: [],
    })
  })

  it('an interface type is a driver-registry id', () => {
    expect(guardDriverIds).toContain('desktop')
    expect(() => InterfaceSchema.parse(iface([NAVIGATE], { type: 'mobile' }))).not.toThrow()
    expect(() => InterfaceSchema.parse({ ...iface([INVOKE]), type: 'smoke-signal' })).toThrow()
  })

  it('an interface needs at least one step', () => {
    expect(() => InterfaceSchema.parse({ ...iface([INVOKE]), steps: [] })).toThrow()
  })

  /**
   * NAMED STATES (2026-08-11). The state contract used to be a sentence per side
   * and a sentence per STEP, chained by whitespace-normalized prose equality.
   * What replaced it: a per-area registry of `{ id, description }`, task-level
   * ids into it, and no step state at all — within a task the chain is step
   * order. These tests hold the three properties that makes the rework worth
   * anything: an id is an id, an id resolves, and a step can no longer carry prose.
   */
  it('a task’s states are ids, never sentences', () => {
    expect(() =>
      InterfaceStateSchema.parse({ id: 'repo-report-open', description: 'The report is open.' }),
    ).not.toThrow()
    // The shape is enforced, because an id is compared by EQUALITY: a sentence
    // in the field is a state nothing can ever chain to.
    for (const bad of ['Repo Report Open', 'on an analyzed repository’s page', 'repo_report_open', '-open', 'open-']) {
      expect(() => InterfaceStateIdSchema.parse(bad), bad).toThrow()
    }
    expect(() =>
      InterfaceSchema.parse(iface([ACTIVATE], { startingState: 'On an analyzed repository’s page.' })),
    ).toThrow()
  })

  it('a step carries no state — the prose fields are gone from the shape', () => {
    expect(() => InterfaceStepSchema.parse({ ...ACTIVATE, input: 'on the page' })).toThrow()
    expect(() => InterfaceStepSchema.parse({ ...ACTIVATE, output: 'the dropdown is open' })).toThrow()
    expect(() =>
      InterfaceSchema.parse(iface([{ ...ACTIVATE, output: 'the dropdown is open' } as InterfaceStep])),
    ).toThrow()
  })

  it('the registry defines an area’s states once, and an interface’s ids must resolve in it', () => {
    const web = (over: Partial<Interface> = {}): Interface =>
      iface([ACTIVATE], {
        id: 'web/silence-rule',
        type: 'web',
        title: 'Silence a rule',
        entry: { method: 'GET', path: '/repos/{repoId}' },
        ...over,
      })
    const file = (over: Record<string, unknown>) => ({
      version: 1 as const,
      generatedAt: '2026-08-11T12:00:00.000Z',
      recipeFingerprint: 'sha256:recipe',
      interfaces: [web({ startingState: 'repo-report-open', endState: 'rule-silenced' })],
      states: {
        web: [
          { id: 'repo-report-open', description: 'The report is open.' },
          { id: 'rule-silenced', description: 'The rule is off and its cards are gone.' },
        ],
      },
      ...over,
    })
    expect(() => InterfacesFileSchema.parse(file({}))).not.toThrow()

    // An id no registry defines is refused — the point of naming states.
    expect(() =>
      InterfacesFileSchema.parse(
        file({ interfaces: [web({ startingState: 'panel-open' })] }),
      ),
    ).toThrow(/`panel-open` is not a state the `web` registry defines/)
    // …including when the registry is absent entirely.
    expect(() => InterfacesFileSchema.parse(file({ states: undefined }))).toThrow()

    // The registry is scoped to the AREA: a cli entry cannot borrow a web state.
    expect(() =>
      InterfacesFileSchema.parse(
        file({ interfaces: [iface([INVOKE], { startingState: 'repo-report-open' })] }),
      ),
    ).toThrow(/the `cli` registry/)

    // One definition per id — a state described twice is two answers.
    expect(() =>
      InterfacesFileSchema.parse(
        file({
          states: {
            web: [
              { id: 'repo-report-open', description: 'The report is open.' },
              { id: 'rule-silenced', description: 'The rule is off and its cards are gone.' },
              { id: 'repo-report-open', description: 'The report is open, again.' },
            ],
          },
        }),
      ),
    ).toThrow(/defined twice/)

    // Additive: a catalog that names no states at all parses unchanged.
    expect(
      InterfacesFileSchema.parse({
        version: 1 as const,
        generatedAt: '2026-08-11T12:00:00.000Z',
        recipeFingerprint: 'sha256:recipe',
        interfaces: [iface([INVOKE])],
      }).states,
    ).toBeUndefined()
  })

  it('round-trips an interfaces file through JSON', () => {
    const file = {
      version: 1 as const,
      generatedAt: '2026-07-24T12:00:00.000Z',
      recipeFingerprint: 'sha256:recipe',
      interfaces: [iface([INVOKE]), iface([REQUEST], { id: 'api/create-task', type: 'api', entry: { method: 'POST', path: '/tasks' } })],
    }
    expect(InterfacesFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file)
  })

  it('an entry is command-rooted OR operation-rooted, never a mix', () => {
    expect(() =>
      InterfaceSchema.parse(iface([REQUEST], { type: 'api', entry: { method: 'POST', path: '/tasks' } })),
    ).not.toThrow()
    expect(() => InterfaceSchema.parse({ ...iface([REQUEST]), entry: { method: 'POST' } })).toThrow()
    expect(() =>
      InterfaceSchema.parse({ ...iface([REQUEST]), entry: { command: ['x'], method: 'POST', path: '/t' } }),
    ).toThrow()
  })

  it('specOnly is optional provenance — only literal true parses', () => {
    const specOnly = { ...iface([REQUEST], { type: 'api', entry: { method: 'GET', path: '/t' } }), specOnly: true as const }
    expect(InterfaceSchema.parse(specOnly).specOnly).toBe(true)
    expect(InterfaceSchema.parse(iface([INVOKE])).specOnly).toBeUndefined()
    expect(() => InterfaceSchema.parse({ ...specOnly, specOnly: false })).toThrow()
  })

  it('records per-surface how the catalog was derived, and tolerates its absence', () => {
    const base = {
      version: 1 as const,
      generatedAt: '2026-07-24T12:00:00.000Z',
      recipeFingerprint: 'sha256:recipe',
      interfaces: [iface([INVOKE])],
    }
    expect(InterfacesFileSchema.parse({ ...base, source: { cli: 'probes' } }).source).toEqual({
      cli: 'probes',
    })
    expect(InterfacesFileSchema.parse(base).source).toBeUndefined()
    expect(() => InterfacesFileSchema.parse({ ...base, source: { cli: 'guessed' } })).toThrow()
  })
})

describe('interfaceFingerprint', () => {
  const fp = (steps: InterfaceStep[], over: Partial<Interface> = {}): string =>
    interfaceFingerprint({ type: 'cli', entry: { command: ['tasks', 'add'] }, steps, ...over })

  it('is a sha256 over the surface-visible shape', () => {
    expect(fp([INVOKE])).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('is stable across identical shapes and moves with the surface type', () => {
    expect(fp([INVOKE])).toBe(fp([INVOKE]))
    expect(fp([INVOKE], { type: 'tui' })).not.toBe(fp([INVOKE]))
  })

  it('moves with the entry command', () => {
    expect(fp([INVOKE], { entry: { command: ['tasks', 'create'] } })).not.toBe(fp([INVOKE]))
  })

  it('an operation entry folds method + path, case-insensitively on the method', () => {
    const op = (method: string, path: string): string =>
      interfaceFingerprint({ type: 'api', entry: { method, path }, steps: [REQUEST] })
    expect(op('post', '/tasks')).toBe(op('POST', '/tasks'))
    expect(op('PUT', '/tasks')).not.toBe(op('POST', '/tasks'))
    expect(op('POST', '/tasks/{id}')).not.toBe(op('POST', '/tasks'))
  })

  it('specOnly is provenance, never identity', () => {
    const shape = { type: 'api' as const, entry: { method: 'GET' as const, path: '/t' }, steps: [REQUEST] }
    expect(interfaceFingerprint(shape)).toBe(interfaceFingerprint({ ...shape }))
  })

  it('the state contract is the world around the task, never identity', () => {
    // The fold takes `type | entry | steps`, so the states cannot reach it — the
    // invariant that let the whole corpus be renamed with no fingerprint moving.
    const stated = iface([ACTIVATE], {
      type: 'web',
      startingState: 'repo-report-open',
      endState: 'rule-silenced',
    })
    expect(stated.fingerprint).toBe(iface([ACTIVATE], { type: 'web' }).fingerprint)
    expect(interfaceFingerprint(stated)).toBe(stated.fingerprint)
  })

  /**
   * `apiEffects` — the UI-to-API relation (2026-08-11). What a click reaches
   * behind the glass is not WHICH task it is, so it parses, it distinguishes
   * "established none" from "not established", and it moves no identity.
   */
  it('the api relation parses, and an empty list is a real answer', () => {
    const withEffects = iface([ACTIVATE], {
      type: 'web',
      apiEffects: ['api/get-api-repos', 'api/get-api-repos-id-violations'],
    })
    expect(InterfaceSchema.parse(JSON.parse(JSON.stringify(withEffects)))).toEqual(withEffects)
    // ESTABLISHED NONE — a purely client-side interaction reaches no route, and
    // saying so is different from saying nothing (the omitted case below).
    const clientSideOnly = iface([ACTIVATE], { type: 'web', apiEffects: [] })
    expect(InterfaceSchema.parse(JSON.parse(JSON.stringify(clientSideOnly))).apiEffects).toEqual([])
    expect(InterfaceSchema.parse(JSON.parse(JSON.stringify(iface([ACTIVATE])))).apiEffects).toBeUndefined()
    // An empty REF is not an answer at all.
    expect(() => InterfaceSchema.parse({ ...clientSideOnly, apiEffects: [''] })).toThrow()
  })

  it('the api relation never moves the fingerprint', () => {
    const bare = iface([ACTIVATE], { type: 'web' })
    expect(interfaceFingerprint({ ...bare, apiEffects: ['api/get-api-repos'] })).toBe(bare.fingerprint)
    expect(interfaceFingerprint({ ...bare, apiEffects: [] })).toBe(bare.fingerprint)
  })

  it('a label is cosmetic — it never moves the fingerprint', () => {
    expect(fp([{ ...INVOKE, label: 'add a task' }])).toBe(fp([INVOKE]))
    expect(fp([{ ...REQUEST, label: 'create' }])).toBe(fp([REQUEST]))
    expect(fp([{ ...NAVIGATE, label: 'the board' }])).toBe(fp([NAVIGATE]))
    expect(fp([{ ...INPUT, label: 'title' }])).toBe(fp([INPUT]))
    expect(fp([{ ...ACTIVATE, label: 'add' }])).toBe(fp([ACTIVATE]))
  })

  it('an invoke step folds its command and its flag SET, not the flag order', () => {
    expect(fp([{ ...INVOKE, flags: ['--force', '--json'] }])).toBe(fp([INVOKE]))
    expect(fp([{ ...INVOKE, flags: ['--json'] }])).not.toBe(fp([INVOKE]))
    expect(fp([{ ...INVOKE, command: ['tasks', 'rm'] }])).not.toBe(fp([INVOKE]))
  })

  it('a request step folds method + path, case-insensitively on the method', () => {
    expect(fp([{ ...REQUEST, method: 'post' }])).toBe(fp([REQUEST]))
    expect(fp([{ ...REQUEST, method: 'PUT' }])).not.toBe(fp([REQUEST]))
    expect(fp([{ ...REQUEST, path: '/tasks/:id' }])).not.toBe(fp([REQUEST]))
  })

  it('a navigate step folds its route; input/activate fold their target', () => {
    expect(fp([{ ...NAVIGATE, route: '/settings' }])).not.toBe(fp([NAVIGATE]))
    expect(fp([{ ...INPUT, target: 'TaskBoard::dueField' }])).not.toBe(fp([INPUT]))
    expect(fp([{ ...ACTIVATE, target: 'TaskRow::doneCheckbox' }])).not.toBe(fp([ACTIVATE]))
  })

  it('the kind is part of the identity — same target, different interaction', () => {
    expect(fp([INPUT])).not.toBe(fp([{ kind: 'activate', target: INPUT.target }])
    )
  })

  it('step order and step count are part of the identity', () => {
    expect(fp([INPUT, ACTIVATE])).not.toBe(fp([ACTIVATE, INPUT]))
    expect(fp([INPUT])).not.toBe(fp([INPUT, INPUT]))
  })

  it('normalizes whitespace inside a payload field', () => {
    expect(fp([{ kind: 'navigate', route: '  /board ' }])).toBe(fp([NAVIGATE]))
  })
})

// ---------------------------------------------------------------------------
// The contract: the full grammar plus each command's input/output as STRUCTURED
// FACTS. Additive and optional — a catalog that carries only the command tree
// must keep parsing, and enriching one must not move a single identity.
// ---------------------------------------------------------------------------

const CONTRACT: InterfaceContract = {
  summary: '`tasks add` and its `--json` mode.',
  commands: [
    {
      path: ['tasks', 'add'],
      description: 'Add a task.',
      options: [
        {
          flag: '--json',
          takesValue: false,
          valueRequired: false,
          scope: 'command',
          description: 'Print the created task as JSON.',
        },
        {
          flag: '--priority',
          short: '-p',
          takesValue: true,
          valueRequired: true,
          valueHint: 'level',
          choices: ['low', 'high'],
          default: 'low',
          scope: 'command',
        },
        { flag: '--debug', takesValue: false, valueRequired: false, hidden: true },
      ],
      positionals: [{ name: 'title', required: true, variadic: false, description: 'The task title.' }],
      subcommands: [],
      io: {
        consumes: {
          prompts: [
            {
              kind: 'select',
              marker: 'Where should tasks live?',
              answerHint: 'home | here',
              submit: 'enter',
              when: 'no config saved',
            },
            { kind: 'confirm', marker: 'Overwrite it?', submit: 'char' },
          ],
          env: [{ var: 'TASKS_HOME' }],
          reads: [
            { path: '~/.tasks.json', when: 'the store the listing renders' },
            { path: '<repo>/.tasks/config.json' },
          ],
        },
        produces: {
          output: [
            { stream: 'stdout', marker: 'Created task ' },
            { stream: 'stderr', marker: 'store is read-only', when: 'the store cannot be written' },
          ],
          rows: [
            {
              role: 'header',
              stream: 'stdout',
              template: 'Tasks for <list>: <shown> shown (<done> done)',
              slots: [
                { name: 'list', kind: 'text' },
                { name: 'shown', kind: 'count' },
                { name: 'done', kind: 'count' },
              ],
            },
            {
              role: 'row',
              stream: 'stdout',
              template: '<state>  <title>',
              slots: [
                { name: 'state', kind: 'enum', values: ['todo', 'done'] },
                { name: 'title', kind: 'text' },
              ],
              when: 'one line per task',
            },
          ],
          exits: [
            { exit: '0', when: 'the task was created' },
            { exit: INTERFACE_UNKNOWN, when: 'the store is unwritable — no exit path is declared in code' },
          ],
          writes: [{ path: '~/.tasks.json', when: 'always' }],
        },
      },
    },
  ],
}

describe('the interface contract', () => {
  it('parses an interface carrying the full contract', () => {
    const rich = { ...iface([INVOKE]), contract: CONTRACT }
    const parsed = InterfaceSchema.parse(JSON.parse(JSON.stringify(rich)))
    expect(parsed).toEqual(rich)
  })

  it('a catalog that carries only the command tree still parses — the growth is additive', () => {
    // Byte-for-byte the shape the mapper writes today: no contract.
    const engineWritten = {
      version: 1 as const,
      generatedAt: '2026-08-06T12:00:00.000Z',
      recipeFingerprint: 'sha256:recipe',
      interfaces: [iface([INVOKE])],
      source: { cli: 'tree' as const },
    }
    const parsed = InterfacesFileSchema.parse(JSON.parse(JSON.stringify(engineWritten)))
    expect(parsed).toEqual(engineWritten)
    expect(parsed.interfaces[0].contract).toBeUndefined()
  })

  it('round-trips a contract-bearing catalog through JSON unchanged', () => {
    const file = {
      version: 1 as const,
      generatedAt: '2026-08-06T12:00:00.000Z',
      recipeFingerprint: 'sha256:recipe',
      interfaces: [{ ...iface([INVOKE]), contract: CONTRACT }],
      source: { cli: 'tree' as const },
    }
    expect(InterfacesFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file)
  })

  it('keeps "established as none" and "never established" apart', () => {
    const none = InterfaceContractSchema.parse({
      commands: [{ path: ['tasks'], subcommands: [], io: { consumes: { prompts: [] }, produces: { writes: [] } } }],
    })
    // Authored empty lists survive as empty lists — they say "none", out loud.
    expect(none.commands[0].io?.consumes?.prompts).toEqual([])
    expect(none.commands[0].io?.produces?.writes).toEqual([])
    expect(none.commands[0].subcommands).toEqual([])
    // A field nobody established stays absent — never coerced into an empty "none".
    const bare = InterfaceContractSchema.parse({ commands: [{ path: ['tasks'] }] })
    expect(bare.commands[0].options).toBeUndefined()
    expect(bare.commands[0].positionals).toBeUndefined()
    expect(bare.commands[0].io).toBeUndefined()
  })

  it('carries what a command READS as the mirror of what it writes', () => {
    // An author seeds a file because the command reads it — so the read side is
    // the same fact shape as the write side: a path, and at most one condition.
    expect(CONTRACT.commands[0].io?.consumes?.reads).toEqual([
      { path: '~/.tasks.json', when: 'the store the listing renders' },
      { path: '<repo>/.tasks/config.json' },
    ])
    expect(InterfaceReadFactSchema.parse({ path: '~/.tasks.json' })).toEqual({ path: '~/.tasks.json' })
    expect(() => InterfaceReadFactSchema.parse({ path: '' })).toThrow()
    expect(() => InterfaceReadFactSchema.parse({ path: '~/.tasks.json', when: '' })).toThrow()

    // "Reads nothing" and "nobody established what it reads" stay different reads.
    const none = InterfaceContractSchema.parse({ commands: [{ path: ['tasks'], io: { consumes: { reads: [] } } }] })
    expect(none.commands[0].io?.consumes?.reads).toEqual([])
    const bare = InterfaceContractSchema.parse({ commands: [{ path: ['tasks'], io: { consumes: { prompts: [] } } }] })
    expect(bare.commands[0].io?.consumes?.reads).toBeUndefined()
  })

  it('records an unestablished exit status as `unknown` rather than a plausible number', () => {
    const exits = CONTRACT.commands[0].io?.produces?.exits ?? []
    expect(exits.map((e) => e.exit)).toContain(INTERFACE_UNKNOWN)
    expect(INTERFACE_UNKNOWN).toBe('unknown')
  })

  it('an option default is any scalar the registration declares', () => {
    for (const value of ['low', 20, true]) {
      const parsed = InterfaceOptionSchema.parse({
        flag: '--x',
        takesValue: true,
        valueRequired: false,
        default: value,
      })
      expect(parsed.default).toBe(value)
    }
    expect(() =>
      InterfaceOptionSchema.parse({ flag: '--x', takesValue: true, valueRequired: false, default: ['a'] }),
    ).toThrow()
  })

  it('is strict about its own vocabulary', () => {
    // Requiredness is not optional — a grammar entry that omits it is not a grammar.
    expect(() => InterfaceOptionSchema.parse({ flag: '--x', takesValue: true })).toThrow()
    expect(() => InterfaceOptionSchema.parse({ flag: '--x', takesValue: true, valueRequired: false, scope: 'shell' })).toThrow()
    expect(() => InterfaceOptionSchema.parse({ flag: '--x', takesValue: true, valueRequired: false, required: true })).toThrow()
    expect(() => InterfaceContractSchema.parse({ commands: [] })).toThrow()
  })

  // -------------------------------------------------------------------------
  // Row grammar: the SHAPE of a line of enumerated / tabular output, as ONE fact
  // kind — a role, the literal template with its `<slot>` placeholders, and what
  // each slot may hold.
  // -------------------------------------------------------------------------

  const rowFact = (over: Record<string, unknown> = {}) => ({
    role: 'row' as const,
    stream: 'stdout' as const,
    template: '<state>  <title>',
    slots: [
      { name: 'state', kind: 'enum' as const, values: ['todo', 'done'] },
      { name: 'title', kind: 'text' as const },
    ],
    ...over,
  })

  it('a row fact is one kind covering header, row and footer alike', () => {
    expect(InterfaceRowRoleSchema.options).toEqual(['header', 'row', 'footer'])
    for (const role of InterfaceRowRoleSchema.options) {
      expect(() => InterfaceRowFactSchema.parse(rowFact({ role }))).not.toThrow()
    }
    // The six shapes the audit named are all ONE kind: a template and its slots.
    const shapes = [
      'Rules for <repo>: <n> shown (<e> enabled, <d> disabled)',
      'Showing <a>–<b> of <n> violations',
      '<severity> <title>',
      '<category>  <status>',
      '<lang>: <n> supported',
      'Summary: <n> new issues, <m> resolved',
    ]
    for (const template of shapes) {
      const slots = [...template.matchAll(/<([^<>]*)>/g)].map((m) => ({ name: m[1], kind: 'text' as const }))
      expect(() => InterfaceRowFactSchema.parse(rowFact({ template, slots }))).not.toThrow()
    }
  })

  it('the slot vocabulary is the closed three-member set, and `values` belongs to `enum`', () => {
    expect(InterfaceSlotKindSchema.options).toEqual(['count', 'enum', 'text'])
    // An enum without its value set says no more than text does.
    expect(() =>
      InterfaceRowFactSchema.parse(rowFact({ slots: [{ name: 'state', kind: 'enum' }, { name: 'title', kind: 'text' }] })),
    ).toThrow()
    // …and a value set on a count or a free string is a claim nobody established.
    expect(() =>
      InterfaceRowFactSchema.parse(
        rowFact({ slots: [{ name: 'state', kind: 'enum', values: ['todo'] }, { name: 'title', kind: 'count', values: ['1'] }] }),
      ),
    ).toThrow()
    expect(() => InterfaceRowFactSchema.parse(rowFact({ slots: [{ name: 'state', kind: 'colour', values: ['red'] }] }))).toThrow()
  })

  it('the template and its slots must agree exactly — neither can promise what the other lacks', () => {
    // A placeholder no slot describes: the template promises a value with no vocabulary.
    expect(() => InterfaceRowFactSchema.parse(rowFact({ template: '<state>  <title>  <due>' }))).toThrow()
    // A slot the line never prints: a vocabulary with nothing to fill.
    expect(() =>
      InterfaceRowFactSchema.parse(rowFact({ template: '<state>', slots: [{ name: 'state', kind: 'text' }, { name: 'title', kind: 'text' }] })),
    ).toThrow()
    // The same name twice in one declaration.
    expect(() =>
      InterfaceRowFactSchema.parse(rowFact({ template: '<title> <title>', slots: [{ name: 'title', kind: 'text' }, { name: 'title', kind: 'count' }] })),
    ).toThrow()
    // A template may REPEAT a slot, though — one vocabulary, two positions.
    expect(() =>
      InterfaceRowFactSchema.parse(rowFact({ template: '<n> of <n>', slots: [{ name: 'n', kind: 'count' }] })),
    ).not.toThrow()
    // A line with no slots at all is a marker, not a shape.
    expect(() => InterfaceRowFactSchema.parse(rowFact({ template: 'Done.', slots: [] }))).toThrow()
    // And it stays strict about its own vocabulary.
    expect(() => InterfaceRowFactSchema.parse(rowFact({ columns: 3 }))).toThrow()
    expect(() => InterfaceRowFactSchema.parse(rowFact({ role: 'total' }))).toThrow()
    expect(() => InterfaceRowFactSchema.parse(rowFact({ when: '' }))).toThrow()
  })

  it('a prompt says HOW its answer is submitted, and the vocabulary is the two delivery classes', () => {
    expect(InterfacePromptSubmitSchema.options).toEqual(['enter', 'char'])
    expect(InterfacePromptFactSchema.parse({ kind: 'select', marker: 'Where?', submit: 'enter' }).submit).toBe('enter')
    expect(InterfacePromptFactSchema.parse({ kind: 'confirm', marker: 'Sure?', submit: 'char' }).submit).toBe('char')
    // Unestablished stays ABSENT — never rounded to a plausible default, because
    // a select answered as a keypress hangs and a keypress answered with a
    // trailing Enter answers the next question too.
    expect(InterfacePromptFactSchema.parse({ kind: 'text', marker: 'Name?' }).submit).toBeUndefined()
    expect(() => InterfacePromptFactSchema.parse({ kind: 'select', marker: 'Where?', submit: 'tab' })).toThrow()
    expect(() => InterfacePromptFactSchema.parse({ kind: 'select', marker: 'Where?', submit: '' })).toThrow()
  })

  it('the io vocabulary is facts only — every free-prose shape is rejected', () => {
    const io = (value: unknown) => () => InterfaceContractSchema.parse({ commands: [{ path: ['tasks'], io: value }] })
    // A marker on a stream nobody has; a prompt whose kind is not answerable.
    expect(io({ produces: { output: [{ stream: 'syslog', marker: 'x' }] } })).toThrow()
    expect(io({ consumes: { prompts: [{ kind: 'wizard', marker: 'x' }] } })).toThrow()
    // Every entry needs its own subject: a marker, a status, a path, a variable.
    expect(io({ produces: { output: [{ stream: 'stdout' }] } })).toThrow()
    expect(io({ produces: { exits: [{ when: 'it failed' }] } })).toThrow()
    expect(io({ produces: { writes: [{ when: 'always' }] } })).toThrow()
    expect(io({ consumes: { env: [{ when: 'always' }] } })).toThrow()
    expect(io({ consumes: { reads: [{ when: 'always' }] } })).toThrow()
    // The prose shapes the narrowing removed: no free-text descriptions of a
    // stream, no `as` gloss explaining a read, no notes on the io side.
    expect(io({ produces: { stdout: [{ shape: 'created line' }] } })).toThrow()
    expect(io({ consumes: { reads: [{ path: '~/.tasks.json', as: 'the task store' }] } })).toThrow()
    expect(io({ consumes: { positionalsNote: 'one title' } })).toThrow()
    expect(io({ produces: { sideEffects: ['writes the store'] } })).toThrow()
    expect(io({ produces: { output: [{ stream: 'stdout', marker: 'x', content: 'the whole line' }] } })).toThrow()
  })

  it('takes no prose about behavior — the artifact is 100% structured facts', () => {
    const command = (value: Record<string, unknown>) =>
      InterfaceContractSchema.parse({ commands: [{ path: ['tasks'], ...value }] })
    // A sentence no fact kind carries is not stored anywhere, under any name:
    // it is either expressible as an exit/output/read/write/prompt fact, or gone.
    expect(() => command({ notes: ['Re-running creates a second task.'] })).toThrow()
    expect(() => command({ notes: [] })).toThrow()
    expect(() => command({ behavior: ['Re-running creates a second task.'] })).toThrow()
    expect(() => InterfaceContractSchema.parse({ commands: [{ path: ['tasks'] }], notes: ['tree-wide'] })).toThrow()
    // What the note used to say lives on as a fact, or not at all.
    expect(() =>
      command({ io: { produces: { writes: [{ path: '~/.tasks.json', when: 're-running appends' }] } } }),
    ).not.toThrow()
  })

  it('carries the calling interface and nothing about itself', () => {
    const contract = (value: Record<string, unknown>) =>
      InterfaceContractSchema.parse({ commands: [{ path: ['tasks'] }], ...value })
    // Provenance, authored decisions, doc-versus-code findings and the shared
    // block are not calling interface — they have no home in the artifact.
    expect(() => contract({ derivedFrom: ['src/cli.ts'] })).toThrow()
    expect(() => contract({ decisions: [{ id: 'x', decision: 'y' }] })).toThrow()
    expect(() => contract({ shared: { stdin: [] } })).toThrow()
    expect(() =>
      InterfaceContractSchema.parse({ commands: [{ path: ['tasks'], inheritsShared: [{ block: 'stdin' }] }] }),
    ).toThrow()
    expect(() =>
      InterfaceSchema.parse({ ...iface([INVOKE]), diagnostics: [{ kind: 'k', subject: 's', detail: 'd' }] }),
    ).toThrow()
  })

  it('the CONTRACT never moves an interface identity — the invariant the whole growth rests on', () => {
    const bare = iface([INVOKE])
    const enriched = { ...bare, contract: CONTRACT }
    // Same shape in, same fingerprint out: grammar and io are what a command
    // TAKES, not which command it is.
    expect(interfaceFingerprint(enriched)).toBe(bare.fingerprint)
    expect(interfaceFingerprint(enriched)).toBe(interfaceFingerprint(bare))
    // …and it stays true when the contract itself changes under a fixed surface.
    const relearned = {
      ...enriched,
      contract: {
        ...CONTRACT,
        commands: [
          {
            ...CONTRACT.commands[0],
            options: [{ flag: '--json', takesValue: true, valueRequired: true, choices: ['pretty', 'raw'] }],
          },
        ],
      },
    }
    expect(interfaceFingerprint(relearned)).toBe(bare.fingerprint)
    // The surface itself still moves it — the fingerprint is not simply inert.
    expect(interfaceFingerprint({ ...bare, steps: [{ ...INVOKE, flags: ['--json', '--quiet'] }] })).not.toBe(
      bare.fingerprint,
    )
  })
})

// ---------------------------------------------------------------------------
// The QUESTION SEQUENCE — for an INTERACTIVE command, the order its questions
// arrive in and the earlier answer that reveals each conditional one. It orders
// the prompts the command already carries (it never introduces a new one), it is
// a contract region of its own rather than an io fact, and `unknown` is a
// first-class value: a sequence the mapper still owes, never a guess.
// ---------------------------------------------------------------------------

const WIZARD_PROMPTS = [
  { kind: 'select' as const, marker: 'Which transport?', answerHint: 'claude-code | api', submit: 'enter' as const },
  { kind: 'select' as const, marker: 'Which provider?', answerHint: 'anthropic | bedrock', submit: 'enter' as const },
  { kind: 'confirm' as const, marker: 'Set an advanced option', submit: 'char' as const },
  { kind: 'text' as const, marker: 'Base URL', submit: 'enter' as const },
]

const WIZARD_SEQUENCE = [
  { prompt: 'Which transport?', kind: 'select' as const },
  { prompt: 'Which provider?', kind: 'select' as const, after: { prompt: 'Which transport?', answer: 'api' } },
  { prompt: 'Set an advanced option', kind: 'confirm' as const, after: { prompt: 'Which transport?', answer: 'api' } },
  { prompt: 'Base URL', kind: 'text' as const, after: { prompt: 'Set an advanced option', answer: 'yes' } },
]

describe('the question sequence', () => {
  const command = (over: Record<string, unknown> = {}) => ({
    path: ['tasks', 'setup'],
    io: { consumes: { prompts: WIZARD_PROMPTS } },
    sequence: WIZARD_SEQUENCE,
    ...over,
  })
  const parse = (over: Record<string, unknown> = {}) =>
    InterfaceContractSchema.parse({ commands: [command(over)] })

  it('orders an interactive command’s questions, each with the kind that answers it', () => {
    const parsed = parse()
    expect(parsed.commands[0].sequence).toEqual(WIZARD_SEQUENCE)
    // A linear run needs no conditions at all — the array order IS the dialogue.
    const linear = parse({
      io: { consumes: { prompts: [WIZARD_PROMPTS[0], WIZARD_PROMPTS[2]] } },
      sequence: [
        { prompt: 'Which transport?', kind: 'select' },
        { prompt: 'Set an advanced option', kind: 'confirm' },
      ],
    })
    expect(linear.commands[0].sequence).toHaveLength(2)
  })

  it('names the earlier question and the answer class that reveals a conditional one', () => {
    const sequence = parse().commands[0].sequence as InterfaceSequenceNode[]
    expect(sequence[3].after).toEqual({ prompt: 'Set an advanced option', answer: 'yes' })
    // The branch is what makes an interactive command scriptable from the interface:
    // the follow-up is asked only down one answer, and the answer is named.
    expect(sequence[1].after).toEqual({ prompt: 'Which transport?', answer: 'api' })
    expect(sequence[0].after).toBeUndefined()
  })

  it('says a question REPEATS rather than listing it twice', () => {
    const looped = parse({
      sequence: [
        ...WIZARD_SEQUENCE.slice(0, 3),
        { ...WIZARD_SEQUENCE[3], repeats: 'once per gateway the account is reached through' },
      ],
    })
    expect((looped.commands[0].sequence as InterfaceSequenceNode[])[3].repeats).toBe(
      'once per gateway the account is reached through',
    )
    // The same question twice is ambiguous — a branch resolves BY MARKER.
    expect(() => parse({ sequence: [...WIZARD_SEQUENCE, WIZARD_SEQUENCE[0]] })).toThrow()
    expect(() => parse({ sequence: [{ prompt: 'Base URL', kind: 'text', repeats: '' }] })).toThrow()
  })

  it('`unknown` is a first-class value — the sequence the mapper still owes', () => {
    const owed = parse({ sequence: INTERFACE_UNKNOWN })
    expect(owed.commands[0].sequence).toBe(INTERFACE_UNKNOWN)
    expect(InterfaceSequenceSchema.parse(INTERFACE_UNKNOWN)).toBe('unknown')
    // …and it is the ONLY word that says so: no near-synonym slips through.
    expect(() => parse({ sequence: 'unestablished' })).toThrow()
    expect(() => parse({ sequence: [] })).toThrow()
  })

  it('orders the command’s OWN prompts — a node naming any other question is rejected', () => {
    expect(() =>
      parse({ sequence: [...WIZARD_SEQUENCE, { prompt: 'Which region?', kind: 'text' }] }),
    ).toThrow(/Which region\?/)
    expect(() =>
      parse({
        sequence: [
          WIZARD_SEQUENCE[0],
          { prompt: 'Base URL', kind: 'text', after: { prompt: 'Which region?', answer: 'us-east-1' } },
        ],
      }),
    ).toThrow()
  })

  it('rejects a node whose answer kind contradicts the prompt it names', () => {
    expect(() =>
      parse({ sequence: [{ prompt: 'Which transport?', kind: 'confirm' }] }),
    ).toThrow(/select/)
  })

  it('a branch points BACKWARD, at a question the run has already asked', () => {
    expect(() =>
      parse({
        sequence: [
          { prompt: 'Which transport?', kind: 'select', after: { prompt: 'Base URL', answer: 'set' } },
          ...WIZARD_SEQUENCE.slice(1),
        ],
      }),
    ).toThrow()
    // Not even itself.
    expect(() =>
      parse({
        sequence: [
          { prompt: 'Which transport?', kind: 'select', after: { prompt: 'Which transport?', answer: 'api' } },
        ],
      }),
    ).toThrow()
  })

  it('a confirm reveals on `yes` or `no`, the only two answers it has', () => {
    for (const answer of ['yes', 'no']) {
      expect(() =>
        parse({
          sequence: [
            ...WIZARD_SEQUENCE.slice(0, 3),
            { prompt: 'Base URL', kind: 'text', after: { prompt: 'Set an advanced option', answer } },
          ],
        }),
      ).not.toThrow()
    }
    expect(() =>
      parse({
        sequence: [
          ...WIZARD_SEQUENCE.slice(0, 3),
          { prompt: 'Base URL', kind: 'text', after: { prompt: 'Set an advanced option', answer: 'accepted' } },
        ],
      }),
    ).toThrow(/yes/)
  })

  it('needs the questions it orders — and a command that asks nothing has no dialogue', () => {
    // Prompts nobody established: there is no dialogue to put in order yet.
    expect(() => InterfaceContractSchema.parse({ commands: [{ path: ['tasks'], sequence: WIZARD_SEQUENCE }] })).toThrow()
    // Prompts established as NONE: the command is not interactive, so a sequence
    // (`unknown` included) would claim a dialogue that provably does not exist.
    const silent = { path: ['tasks'], io: { consumes: { prompts: [] } } }
    expect(() => InterfaceContractSchema.parse({ commands: [{ ...silent, sequence: WIZARD_SEQUENCE }] })).toThrow()
    expect(() => InterfaceContractSchema.parse({ commands: [{ ...silent, sequence: INTERFACE_UNKNOWN }] })).toThrow()
    expect(InterfaceContractSchema.parse({ commands: [silent] }).commands[0].sequence).toBeUndefined()
  })

  it('is a contract REGION of its own, not an io fact', () => {
    // It sits beside the io, because it is not another thing a scenario asserts:
    // it is the ORDER over questions the prompt facts already carry. Putting it
    // inside `io` would count every question twice and break the facts-only rule.
    expect(() =>
      InterfaceContractSchema.parse({
        commands: [{ path: ['tasks'], io: { consumes: { prompts: WIZARD_PROMPTS }, sequence: WIZARD_SEQUENCE } }],
      }),
    ).toThrow()
    expect(() =>
      InterfaceContractSchema.parse({
        commands: [{ path: ['tasks'], io: { consumes: { prompts: WIZARD_PROMPTS, sequence: WIZARD_SEQUENCE } } }],
      }),
    ).toThrow()
  })

  it('is strict about its own vocabulary', () => {
    expect(() => parse({ sequence: [{ prompt: 'Which transport?' }] })).toThrow()
    expect(() => parse({ sequence: [{ prompt: 'Which transport?', kind: 'wizard' }] })).toThrow()
    expect(() => parse({ sequence: [{ prompt: '', kind: 'select' }] })).toThrow()
    expect(() =>
      parse({ sequence: [{ prompt: 'Which transport?', kind: 'select', optional: true }] }),
    ).toThrow()
    expect(() =>
      parse({ sequence: [{ prompt: 'Which transport?', kind: 'select', when: 'a TTY' }] }),
    ).toThrow()
    expect(() =>
      parse({
        sequence: [
          WIZARD_SEQUENCE[0],
          { prompt: 'Which provider?', kind: 'select', after: { prompt: 'Which transport?' } },
        ],
      }),
    ).toThrow()
    expect(() =>
      parse({
        sequence: [
          WIZARD_SEQUENCE[0],
          {
            prompt: 'Which provider?',
            kind: 'select',
            after: { prompt: 'Which transport?', answer: 'api', unless: 'x' },
          },
        ],
      }),
    ).toThrow()
  })

  it('never moves an interface identity — the same invariant the whole contract rests on', () => {
    const bare = iface([INVOKE])
    const withSequence = {
      ...bare,
      contract: {
        commands: [
          { path: ['tasks', 'setup'], io: { consumes: { prompts: WIZARD_PROMPTS } }, sequence: WIZARD_SEQUENCE },
        ],
      },
    }
    expect(interfaceFingerprint(withSequence)).toBe(bare.fingerprint)
    // Learning the sequence, then RE-learning it differently, both leave it put.
    const relearned = {
      ...withSequence,
      contract: {
        commands: [
          {
            ...withSequence.contract.commands[0],
            sequence: INTERFACE_UNKNOWN,
          },
        ],
      },
    }
    expect(interfaceFingerprint(relearned)).toBe(bare.fingerprint)
    expect(InterfaceSchema.parse(JSON.parse(JSON.stringify(withSequence)))).toEqual(withSequence)
  })
})

/**
 * The hand-authored reference catalog is the generation target, so it is also the
 * corpus this schema has to load. What is checked here is the CONVERSION: the
 * prose the pre-narrowing artifact carried — free-text `reads`, then the behavior
 * notes — is now structured facts on the command that does the thing, shared facts
 * are folded into every command that inherited them, and a command the source
 * recorded as reading nothing keeps its empty list.
 */
describe('the reference catalog', () => {
  const file = path.resolve(__dirname, '../../reference/store/.truecourse/guard/interfaces.json')
  const catalog = InterfacesFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8')))
  // Three surfaces live here now: the cli trees and the api operations carry
  // the command contract (`contracted`); the web task interfaces carry a state
  // contract instead (steps + starting/end state, no command grammar).
  const cli = catalog.interfaces.filter((j) => j.type === 'cli')
  const web = catalog.interfaces.filter((j) => j.type === 'web')
  const contracted = catalog.interfaces.filter((j) => j.type !== 'web')
  const commands = (id: string) => catalog.interfaces.find((j) => j.id === id)!.contract!.commands
  // One entry per invocable thing (2026-08-10), so a command is reached by the
  // argv a user types, and a FAMILY by its `group` — never by walking one entry's
  // command list, which is now exactly one command long.
  const byArgv = new Map(
    contracted.flatMap((j) => j.contract!.commands.map((c) => [c.path.join(' '), c] as const)),
  )
  const command = (argv: string) => byArgv.get(argv)!
  const family = (group: string) =>
    cli.filter((j) => j.group === group).flatMap((j) => j.contract!.commands)
  const reads = (commandPath: string) => command(commandPath).io!.consumes!.reads!

  it('loads green, every contract included', () => {
    // The dashboard server's HTTP API joined the catalog as a REALIZATION surface
    // (2026-08-10): interfaces for the routes the Code Analysis section really calls,
    // so a flow the docs state can be realized through them. Its own flows are not
    // implied — the docs do not promise the API as a feature. 25 operations in the
    // first pass, 32 once analytics and the rule catalogue joined the same day —
    // the whole set the client reaches while serving that section. Order is
    // REGISTRATION order, which is why the two repos-router rule routes sit up with
    // the other repos ones and `/api/rules`, mounted last, is last.
    //
    // 57 entries: the cli's SEVEN command trees became 22 per-command entries with
    // the INTERFACE granularity decision (2026-08-10) — one entry per invocable
    // thing — beside the 32 per-operation api entries and the 3 per-task web ones.
    // The command COUNT did not move (a tree's commands were already enumerated);
    // what moved is which entry each one lives in.
    //
    // 114 since the 2026-08-11 dashboard waves: 27 cli commands, 32 api
    // operations and 55 Code Analysis web tasks. Registration order is pinned.
    expect(catalog.interfaces.map((j) => j.id)).toEqual([
      'cli/add',
      'cli/analyze',
      'cli/config',
      'cli/config-llm',
      'cli/config-llm-setup',
      'cli/config-llm-show',
      'cli/config-llm-test',
      'cli/config-llm-use',
      'cli/hooks',
      'cli/hooks-install',
      'cli/hooks-uninstall',
      'cli/hooks-status',
      'cli/hooks-run',
      'cli/list',
      'cli/root',
      'cli/rules',
      'cli/rules-categories',
      'cli/rules-llm',
      'cli/rules-list',
      'cli/rules-enable',
      'cli/rules-disable',
      'cli/rules-reset',
      'cli/dashboard',
      'cli/dashboard-stop',
      'cli/dashboard-status',
      'cli/dashboard-logs',
      'cli/dashboard-uninstall',
      'api/get-api-capabilities',
      'api/post-api-repos',
      'api/get-api-repos',
      'api/get-api-repos-browse',
      'api/get-api-repos-id',
      'api/delete-api-repos-id',
      'api/get-api-repos-id-rules',
      'api/patch-api-repos-id-rules-rulekey',
      'api/post-api-repos-id-analyses',
      'api/post-api-repos-id-analyses-cancel',
      'api/get-api-repos-id-analyses',
      'api/get-api-repos-id-analyses-diff',
      'api/get-api-repos-id-analyses-analysisid-usage',
      'api/delete-api-repos-id-analyses-analysisid',
      'api/get-api-repos-id-graph',
      'api/put-api-repos-id-graph-positions',
      'api/delete-api-repos-id-graph-positions',
      'api/put-api-repos-id-graph-collapsed',
      'api/get-api-repos-id-files',
      'api/get-api-repos-id-file-content',
      'api/get-api-repos-id-violations',
      'api/get-api-repos-id-violations-summary',
      'api/get-api-repos-id-databases',
      'api/get-api-repos-id-databases-dbid-schema',
      'api/get-api-repos-id-flows',
      'api/get-api-repos-id-flows-flowid',
      'api/post-api-repos-id-flows-flowid-enrich',
      'api/get-api-repos-id-analytics-trend',
      'api/get-api-repos-id-analytics-breakdown',
      'api/get-api-repos-id-analytics-top-offenders',
      'api/get-api-repos-id-analytics-resolution',
      'api/get-api-rules',
      'web/open-dashboard-home',
      'web/open-repo-report',
      'web/add-repository-by-path',
      'web/silence-rule-from-violation-card',
      'web/reenable-rule-from-rules-panel',
      'web/disable-rule-from-rules-panel',
      'web/filter-violations-by-category',
      'web/switch-to-the-guard-section',
      'web/open-rules-panel',
      'web/search-rules-panel',
      'web/filter-rules-by-detection',
      'web/filter-rules-by-category',
      'web/open-an-unanalyzed-repository',
      'web/run-an-analysis-from-the-header',
      'web/stash-pending-changes-before-a-run',
      'web/analyze-working-tree-without-stashing',
      'web/approve-the-llm-rules-for-a-run',
      'web/skip-the-llm-rules-for-a-run',
      'web/cancel-a-running-analysis',
      'web/filter-violations-by-severity',
      'web/search-the-violation-list',
      'web/narrow-violations-to-llm-findings',
      'web/clear-the-category-filter',
      'web/reveal-a-violations-fix-prompt',
      'web/copy-a-violations-fix-prompt',
      'web/sort-top-offenders-by-critical-count',
      'web/scope-violations-to-a-top-offender',
      'web/scope-violations-to-a-hotspot-file',
      'web/open-the-graphs-tab',
      'web/change-the-graph-depth-to-modules',
      'web/change-the-graph-depth-to-functions',
      'web/fit-the-graph-to-the-viewport',
      'web/reset-the-graph-layout',
      'web/collapse-every-graph-container',
      'web/open-the-files-tab',
      'web/open-a-file-in-the-code-viewer',
      'web/open-the-flows-tab',
      'web/open-a-flow-diagram',
      'web/search-the-flow-list',
      'web/step-forward-through-a-flow',
      'web/step-back-through-a-flow',
      'web/play-the-open-flow',
      'web/enrich-a-flow-with-descriptions',
      'web/open-the-databases-tab',
      'web/open-a-database-schema',
      'web/switch-the-schema-to-the-table-list',
      'web/expand-a-schema-table',
      'web/open-the-analyses-tab',
      'web/view-a-past-analysis',
      'web/open-a-runs-usage-breakdown',
      'web/delete-a-past-analysis',
      'web/enter-git-diff-mode',
      'web/leave-git-diff-mode',
      'web/open-a-changed-file-from-diff',
      'web/toggle-a-file-tree-folder',
    ])
    // Every command answers "what do I read?" — none is silent. 27 cli commands
    // (one per entry since the split) + the api surface's 32 operations = 59.
    const all = contracted.flatMap((j) => j.contract!.commands)
    expect(all).toHaveLength(59)
    expect(all.every((c) => c.io?.consumes?.reads !== undefined)).toBe(true)
    // 97 cli reads + 105 api reads (the registry lookup, store files, git objects
    // and rule catalogue each operation consults) = 202.
    expect(all.reduce((n, c) => n + c.io!.consumes!.reads!.length, 0)).toBe(202)
  })

  it('the web task interfaces carry their state contract, one task each', () => {
    expect(web.map((j) => j.id)).toEqual([
      'web/open-dashboard-home',
      'web/open-repo-report',
      'web/add-repository-by-path',
      'web/silence-rule-from-violation-card',
      'web/reenable-rule-from-rules-panel',
      'web/disable-rule-from-rules-panel',
      'web/filter-violations-by-category',
      'web/switch-to-the-guard-section',
      'web/open-rules-panel',
      'web/search-rules-panel',
      'web/filter-rules-by-detection',
      'web/filter-rules-by-category',
      'web/open-an-unanalyzed-repository',
      'web/run-an-analysis-from-the-header',
      'web/stash-pending-changes-before-a-run',
      'web/analyze-working-tree-without-stashing',
      'web/approve-the-llm-rules-for-a-run',
      'web/skip-the-llm-rules-for-a-run',
      'web/cancel-a-running-analysis',
      'web/filter-violations-by-severity',
      'web/search-the-violation-list',
      'web/narrow-violations-to-llm-findings',
      'web/clear-the-category-filter',
      'web/reveal-a-violations-fix-prompt',
      'web/copy-a-violations-fix-prompt',
      'web/sort-top-offenders-by-critical-count',
      'web/scope-violations-to-a-top-offender',
      'web/scope-violations-to-a-hotspot-file',
      'web/open-the-graphs-tab',
      'web/change-the-graph-depth-to-modules',
      'web/change-the-graph-depth-to-functions',
      'web/fit-the-graph-to-the-viewport',
      'web/reset-the-graph-layout',
      'web/collapse-every-graph-container',
      'web/open-the-files-tab',
      'web/open-a-file-in-the-code-viewer',
      'web/open-the-flows-tab',
      'web/open-a-flow-diagram',
      'web/search-the-flow-list',
      'web/step-forward-through-a-flow',
      'web/step-back-through-a-flow',
      'web/play-the-open-flow',
      'web/enrich-a-flow-with-descriptions',
      'web/open-the-databases-tab',
      'web/open-a-database-schema',
      'web/switch-the-schema-to-the-table-list',
      'web/expand-a-schema-table',
      'web/open-the-analyses-tab',
      'web/view-a-past-analysis',
      'web/open-a-runs-usage-breakdown',
      'web/delete-a-past-analysis',
      'web/enter-git-diff-mode',
      'web/leave-git-diff-mode',
      'web/open-a-changed-file-from-diff',
      'web/toggle-a-file-tree-folder',
    ])
    for (const j of web) {
      // A task from a specific state: both ends of the state contract present.
      expect(j.startingState).toBeTruthy()
      expect(j.endState).toBeTruthy()
      // Steps are the user's interactions: an address the user asks for, or an
      // element located by role + accessible name (the §10.3 locator policy) —
      // never a page inventory. And, since 2026-08-11, nothing else: the per-step
      // prose is gone, so a step is its kind and its target and no world around it.
      expect(j.steps.length).toBeLessThanOrEqual(3)
      for (const step of j.steps) {
        expect(['navigate', 'activate', 'input']).toContain(step.kind)
        if ('target' in step) expect(step.target).toMatch(/^[a-z]+ ".+"$/)
        if ('route' in step) expect(step.route).toMatch(/^\//)
        expect(Object.keys(step).sort()).toEqual(['kind', 'target' in step ? 'target' : 'route'].sort())
      }
      // The identity recomputes through the real fold.
      expect(j.fingerprint).toBe(interfaceFingerprint(j))
      // No command contract: a page task has no argv grammar to carry.
      expect(j.contract).toBeUndefined()
    }
  })

  /**
   * NAMED STATES (2026-08-11). The dashboard area's registry, authored from the
   * Code Analysis tasks: each state is defined once and referenced by id.
   * The pin is the SIZE — a registry that grows a state per task is prose with
   * extra steps, and the whole point is that tasks meet on shared names.
   */
  it('the web area’s states are a small registry, and every task points into it', () => {
    const registry = catalog.states!.web
    expect(registry.map((s) => s.id)).toEqual([
      'dashboard-serving',
      'dashboard-home-open',
      'repository-added-from-path',
      'repo-report-open',
      'violations-filtered-by-category',
      'rule-silenced',
      'rule-reenabled',
      'code-analysis-section-open',
      'guard-section-open',
      'rules-panel-open',
      'rules-panel-filtered',
      'repo-no-analysis-open',
      'analysis-running',
      'analysis-cancelling',
      'stash-prompt-open',
      'llm-estimate-open',
      'violations-filtered-by-severity',
      'violations-searched',
      'violations-filtered-to-llm-findings',
      'fix-prompt-revealed',
      'fix-prompt-copied',
      'top-offenders-sorted-by-critical',
      'violations-scoped-to-an-offender',
      'violations-scoped-to-a-file',
      'graph-open',
      'graph-at-module-depth',
      'graph-at-function-depth',
      'graph-fitted',
      'graph-layout-reset',
      'graph-containers-collapsed',
      'file-tree-open',
      'file-tree-folder-toggled',
      'code-viewer-open',
      'flow-list-open',
      'flow-list-searched',
      'flow-diagram-open',
      'flow-step-one',
      'flow-playback-complete',
      'flow-enriched',
      'database-list-open',
      'database-schema-open',
      'schema-table-list-open',
      'schema-table-expanded',
      'analyses-list-open',
      'past-analysis-selected',
      'usage-breakdown-open',
      'past-analysis-deleted',
      'diff-mode-on',
    ])
    // 48 states for 55 tasks (110 references): shared states are the registry
    // earning its keep across filters, tabs and run gates.
    const referenced = web.flatMap((j) => [j.startingState!, j.endState!])
    expect(referenced).toHaveLength(110)
    expect(new Set(referenced).size).toBe(48)
    // Every state is described once, in one line, and no id is dead weight.
    for (const state of registry) {
      expect(state.description).not.toMatch(/\n/)
      expect(referenced, state.id).toContain(state.id)
    }
    // Only the web area has states today; cli and api tasks state none.
    expect(Object.keys(catalog.states!)).toEqual(['web'])
    for (const j of contracted) {
      expect(j.startingState).toBeUndefined()
      expect(j.endState).toBeUndefined()
    }
  })

  /**
   * CHAIN INTEGRITY BY ID EQUALITY — the property the rework exists for. The PoC
   * mixed flow `review-analysis-and-silence-a-rule-in-the-dashboard` walks three
   * tasks in order (its notes name them); under prose each handoff was two
   * sentences saying the same thing two ways, and nothing could check it. Now the
   * end of one task IS the start of the next, by string equality.
   */
  it('the PoC flow’s tasks chain end-to-start, by id', () => {
    const walk = [
      'web/open-repo-report',
      'web/silence-rule-from-violation-card',
      'web/reenable-rule-from-rules-panel',
    ].map((id) => catalog.interfaces.find((j) => j.id === id)!)

    expect(walk.map((j) => [j.startingState, j.endState])).toEqual([
      ['dashboard-home-open', 'repo-report-open'],
      ['repo-report-open', 'rule-silenced'],
      ['rule-silenced', 'rule-reenabled'],
    ])
    walk.forEach((j, i) => {
      const next = walk[i + 1]
      if (next) expect(next.startingState, `${j.id} → ${next.id}`).toBe(j.endState)
    })
    // And the walk's own entry state is reachable: the home task produces it.
    expect(catalog.interfaces.find((j) => j.id === 'web/open-dashboard-home')!.endState).toBe(
      walk[0].startingState,
    )
  })

  /**
   * THE UI-TO-API RELATION (2026-08-11) — the field plan §2 asks a realization
   * surface for: which operations a screen reaches. What is checked is that it
   * points at real entries of THIS catalog and that its two absences stay
   * distinguishable, because a relation nobody can resolve is worse than none.
   */
  it('every web task states which api operations it reaches, by catalog id', () => {
    const apiIds = new Set(catalog.interfaces.filter((j) => j.type === 'api').map((j) => j.id))
    for (const j of web) {
      for (const ref of j.apiEffects ?? []) expect(apiIds, `${j.id} → ${ref}`).toContain(ref)
    }
    // Reading the report is READS only; silencing a rule WRITES the rule, then
    // re-reads what the write changed.
    expect(catalog.interfaces.find((j) => j.id === 'web/open-repo-report')!.apiEffects).toContain(
      'api/get-api-repos-id-violations',
    )
    expect(
      catalog.interfaces.find((j) => j.id === 'web/silence-rule-from-violation-card')!.apiEffects,
    ).toContain('api/patch-api-repos-id-rules-rulekey')
    // The one task that is established to reach NOTHING: the category tabs filter
    // state the page already holds. An empty list, never an omitted field.
    expect(
      catalog.interfaces.find((j) => j.id === 'web/filter-violations-by-category')!.apiEffects,
    ).toEqual([])
    // …and the one still unestablished stays omitted rather than claiming none:
    // the section switch loads a whole other surface, whose reads the one-hop
    // resolution has not been run over.
    expect(
      catalog.interfaces.find((j) => j.id === 'web/switch-to-the-guard-section')!.apiEffects,
    ).toBeUndefined()
  })

  it('is 100% structured facts — no command carries a sentence about behavior', () => {
    const all = contracted.flatMap((j) => j.contract!.commands)
    for (const command of all) {
      expect(Object.keys(command)).not.toContain('notes')
    }
    // The count the schema now guarantees: every io entry is one of the seven
    // fact kinds. 1530 while cli/spec and cli/guard were in the catalog
    // (2026-08-09); 443 with the analyze-only corpus (2026-08-10); 997 once the
    // api surface joined the same day (554 of them on its 32 operations); 1135
    // after the dashboard CLI family and full Code Analysis interface wave.
    const facts = all.reduce((n, c) => {
      const io = c.io ?? {}
      const sides = [io.consumes ?? {}, io.produces ?? {}]
      return n + sides.reduce((m, side) => m + Object.values(side).reduce((k, list) => k + list.length, 0), 0)
    }, 0)
    expect(facts).toBe(1135)
  })

  it('carries the row grammar of every enumerated listing the CLI prints', () => {
    const rowsOf = (commandPath: string) => command(commandPath).io!.produces!.rows!

    // 89 with the spec and guard trees' listings (2026-08-09); back to the
    // 25 shapes of the 7-interface catalog with those trees gone (2026-08-10),
    // then 31 when the dashboard CLI family joined. The api and web surfaces add
    // none: a row grammar is the shape
    // of a PRINTED line, and a JSON response has no such thing.
    const all = contracted.flatMap((j) => j.contract!.commands)
    expect(all.reduce((n, c) => n + (c.io?.produces?.rows?.length ?? 0), 0)).toBe(31)
    expect(rowsOf('truecourse analyze')).toHaveLength(3)
    expect(rowsOf('truecourse list')).toHaveLength(9)
    expect(rowsOf('truecourse rules categories')).toHaveLength(2)
    expect(rowsOf('truecourse rules llm')).toHaveLength(1)
    expect(rowsOf('truecourse rules list')).toHaveLength(5)
    expect(rowsOf('truecourse config llm show')).toHaveLength(5)

    // The shapes the sufficiency audit named, each as ONE template + its slots.
    const templates = all.flatMap((c) => c.io?.produces?.rows ?? []).map((r) => r.template)
    expect(templates).toContain('Rules for <repo>: <shown> shown (<enabled> enabled, <disabled> disabled).')
    expect(templates).toContain('Showing <from>–<to> of <total> violations (<bySeverity>)')
    expect(templates).toContain('<icon> <severity>  <title>')
    expect(templates).toContain('<category> <status>')
    expect(templates).toContain('Summary: <new> new issues, <resolved> resolved')

    // A closed value set is carried by the slot, not hinted at in the template:
    // the enabled/disabled column is an `enum`, the counts are `count`.
    const category = rowsOf('truecourse rules categories')[1]
    expect(category.role).toBe('row')
    expect(category.slots.find((s) => s.name === 'status')).toEqual({
      name: 'status',
      kind: 'enum',
      values: ['enabled', 'disabled'],
    })
    const header = rowsOf('truecourse rules list')[0]
    expect(header.role).toBe('header')
    expect(header.slots.filter((s) => s.kind === 'count').map((s) => s.name)).toEqual([
      'shown',
      'enabled',
      'disabled',
    ])

    // Every template's slots and placeholders agree — the schema's own invariant,
    // asserted over the corpus so a hand edit cannot quietly break it.
    for (const fact of all.flatMap((c) => c.io?.produces?.rows ?? [])) {
      const used = [...fact.template.matchAll(/<([^<>]*)>/g)].map((m) => m[1])
      expect(new Set(used)).toEqual(new Set(fact.slots.map((s) => s.name)))
    }
  })

  it('says how every prompt is answered — select and text on Enter, a confirm on a keypress', () => {
    // 46 after the dashboard CLI family joined; api and web operations ask
    // nothing on stdin, so their contracts carry no prompt list.
    const prompts = contracted
      .flatMap((j) => j.contract!.commands)
      .flatMap((c) => c.io?.consumes?.prompts ?? [])
    expect(prompts).toHaveLength(46)
    expect(prompts.every((p) => p.submit !== undefined)).toBe(true)
    // The two delivery classes the runner's terminal layer has, and which prompt
    // kind lands in which: a y/n confirm submits on the character itself.
    const byKind = new Map(prompts.map((p) => [p.kind, p.submit]))
    expect(Object.fromEntries(byKind)).toEqual({ select: 'enter', text: 'enter', confirm: 'char' })
  })

  it('carries the `config llm` family the audit found missing — grammar, prompts and all', () => {
    const config = family('config')
    expect(config.map((c) => c.path.join(' '))).toEqual([
      'truecourse config',
      'truecourse config llm',
      'truecourse config llm setup',
      'truecourse config llm show',
      'truecourse config llm test',
      'truecourse config llm use',
    ])

    const setup = config[2]
    // The full flag grammar, choices included where commander enforces them.
    expect(setup.options!.map((o) => o.flag)).toEqual([
      '--transport',
      '--provider',
      '--model',
      '--fallback-model',
      '--api-key',
      '--api-key-env',
      '--api-key-stdin',
      '--base-url',
      '--region',
      '--access-key-id',
      '--secret-access-key',
      '--session-token',
      '--header',
      '--no-test',
      '--help',
      '--version',
    ])
    expect(setup.options!.find((o) => o.flag === '--transport')!.choices).toEqual(['claude-code', 'api'])
    expect(setup.options!.find((o) => o.flag === '--provider')!.choices).toEqual([
      'anthropic',
      'openai',
      'bedrock',
      'copilot',
    ])
    // The wizard's questions, each with the keystroke that submits it.
    expect(setup.io!.consumes!.prompts!).toHaveLength(11)
    expect(setup.io!.consumes!.prompts!.filter((p) => p.submit === 'char').map((p) => p.marker)).toEqual([
      'Set an advanced option',
    ])

    // `use <mode>` takes its positional; the group commands take none.
    expect(config[5].positionals).toEqual([
      {
        name: 'mode',
        required: true,
        variadic: false,
        description: expect.stringContaining('Validated in the action, NOT by commander'),
      },
    ])

    // `config llm *` is the first-run wizard, so it is excluded from it: every
    // subcommand's prompt list is an established fact, and only setup asks.
    for (const command of config) {
      expect(command.io!.consumes!.prompts).toBeDefined()
    }
    expect(config.filter((c) => c.io!.consumes!.prompts!.length > 0)).toHaveLength(1)

    // Only `show` prints a listing; the rest established that they print none.
    expect(config.map((c) => c.io!.produces!.rows!.length)).toEqual([0, 0, 0, 5, 0, 0])
  })

  it('carries what the behavior notes said as facts on the command that does it', () => {
    const produces = (commandPath: string) => command(commandPath).io!.produces!

    // "runs `git stash push` … and `git stash pop` after it" — a write a scenario
    // watches, so it survives as one; the log-only budget skip is a second write
    // on the same log, under its own condition.
    const analyze = produces('truecourse analyze').writes!
    expect(analyze.map((w) => w.path)).toContain('git stash')
    expect(analyze.filter((w) => w.path === '<repo>/.truecourse/logs/analyze.log')).toHaveLength(2)

    // "`--version` … resolves on every subcommand … and exits 0" — an exit fact
    // whose condition names the scope, on the command that declares the flag.
    expect(produces('truecourse').exits!.map((e) => e.when)).toContainEqual(
      expect.stringContaining('on ANY subcommand'),
    )

    // The `.git` walk the hook does before it reads anything — the state a
    // worktree scenario has to arrange.
    expect(reads('truecourse hooks run')[0].path).toBe('<cwd ancestors>/.git')
  })

  it('puts every read fact on the command that reads it', () => {
    expect(reads('truecourse add')).toHaveLength(5)
    expect(reads('truecourse analyze')).toHaveLength(13)
    expect(family('hooks').map((c) => c.io!.consumes!.reads!.length)).toEqual([0, 2, 1, 2, 7])
    expect(reads('truecourse list')).toHaveLength(5)

    // The condition survives the conversion; the prose gloss around it does not.
    expect(reads('truecourse hooks run')).toContainEqual({
      path: 'git index',
      when: '`git diff --cached --name-only --diff-filter=ACM` — no staged files → pass',
    })
    expect(reads('truecourse list').map((r) => r.path)).toContain('<repo>/.truecourse/diff.json')
  })

  it('folds the shared reads into every command that inherited them', () => {
    // The artifact has no shared block: the four facts the `rules` group stated
    // once are carried by each SUBcommand, and the group itself reads nothing.
    expect(family('rules').map((c) => c.io!.consumes!.reads!.length)).toEqual([0, 4, 4, 4, 4, 4, 4])
    for (const entry of family('rules').slice(1)) {
      expect(entry.io!.consumes!.reads!.map((r) => r.path)).toEqual([
        '<cwd ancestors>/.truecourse/',
        '~/.truecourse/registry.json',
        '<repo>/.truecourse/config.json',
        'built-in rule catalog',
      ])
    }
  })

  it('keeps "reads nothing" as an established fact, and every identity where it was', () => {
    // `truecourse` (root) reads no files at all — said out loud, not left absent.
    expect(reads('truecourse')).toEqual([])
    // The whole point of the growth: enriching the contract rolls no interface.
    for (const iface of catalog.interfaces) {
      expect(interfaceFingerprint(iface)).toBe(iface.fingerprint)
    }
  })

  it('every INTERACTIVE command carries its question sequence, and no other command does', () => {
    const all = cli.flatMap((j) => j.contract!.commands)
    const interactive = all.filter((c) => (c.io?.consumes?.prompts?.length ?? 0) > 0)
    // 18 over the Code Analysis corpus after the dashboard CLI family joined.
    expect(interactive).toHaveLength(18)
    for (const command of interactive) {
      expect(command.sequence, command.path.join(' ')).toBeDefined()
    }
    // A command established as asking nothing has no dialogue to order — and the
    // catalog states that by carrying no sequence, not by carrying an empty one.
    // The api operations are in this set too (2026-08-10): no prompts, no sequence.
    for (const command of all.filter((c) => (c.io?.consumes?.prompts?.length ?? 0) === 0)) {
      expect(command.sequence, command.path.join(' ')).toBeUndefined()
    }
    // Every question the corpus records is placed, in the order the prompt list
    // itself records them (that list is written in arrival order): a sequence
    // that skipped one is a dialogue a generator cannot script to the end.
    for (const command of interactive) {
      const sequence = command.sequence
      if (sequence === INTERFACE_UNKNOWN) continue
      expect(sequence!.map((n) => n.prompt), command.path.join(' ')).toEqual(
        command.io!.consumes!.prompts!.map((p) => p.marker),
      )
    }
  })

  it('the sequence is a REGION, not a fact — the io tally does not move for it', () => {
    // The decision the pins above encode: a sequence entry is the ORDER over
    // questions the prompt facts already carry, so counting it would count every
    // question twice. 1135 io facts with sequences, 1135 without.
    const all = contracted.flatMap((j) => j.contract!.commands)
    const facts = (command: InterfaceCommandContract) => {
      const io = command.io ?? {}
      return [io.consumes ?? {}, io.produces ?? {}].reduce(
        (m, side) => m + Object.values(side).reduce((k, list) => k + list.length, 0),
        0,
      )
    }
    expect(all.reduce((n, c) => n + facts(c), 0)).toBe(1135)
    // …and the sequences really are there to have been excluded.
    expect(all.reduce((n, c) => n + (Array.isArray(c.sequence) ? c.sequence.length : 0), 0)).toBe(46)
  })

  it('branches the first-run wizard exactly as the CLI asks it', () => {
    const setup = command('truecourse config llm setup')
    const sequence = setup.sequence as InterfaceSequenceNode[]
    const node = (marker: string) => sequence.find((n) => n.prompt === marker)!

    // The transport answer opens the whole API branch — nothing below is asked
    // when the answer is Claude Code.
    expect(node('Which provider?').after).toEqual({
      prompt: 'How should TrueCourse run its LLM calls?',
      answer: 'API',
    })
    // The branch the spec names: the base URL is asked only after the advanced
    // confirm is accepted — a `yes`, the only two answers a confirm has.
    expect(node('Base URL').after).toEqual({ prompt: 'Set an advanced option', answer: 'yes' })
    // Provider splits the credential questions: bedrock asks for three AWS
    // fields, everything else asks for one key.
    expect(node('AWS region').after).toEqual({ prompt: 'Which provider?', answer: 'bedrock' })
    expect(node('API key').after).toEqual({
      prompt: 'Which provider?',
      answer: 'anthropic | openai | copilot',
    })
    // The question the whole wizard ends on, and the loop it sits in.
    expect(node('What now?').repeats).toMatch(/until/)
    expect(node('How should TrueCourse run its LLM calls?').after).toBeUndefined()
  })

  it('puts the first-run question first on every command that can be asked it', () => {
    // It is asked in the program's `preAction` hook, so it precedes the command's
    // own work — every sequence that carries it opens with it.
    const asked = cli
      .flatMap((j) => j.contract!.commands)
      // `?? []` because a contract may carry no prompt list at all — the api
      // operations do not, having no stdin to ask on (2026-08-10).
      .filter((c) => (c.io?.consumes?.prompts ?? []).some((p) => p.marker.startsWith('How should TrueCourse run')))
    // Every interactive command in the catalog can be asked it — 18 across the
    // Code Analysis CLI surface; it was >30 with the spec and guard trees.
    expect(asked).toHaveLength(18)
    for (const command of asked) {
      const sequence = command.sequence as InterfaceSequenceNode[]
      expect(sequence[0].prompt, command.path.join(' ')).toBe('How should TrueCourse run its LLM calls?')
      expect(sequence[0].after, command.path.join(' ')).toBeUndefined()
    }
  })

  // `guard setup`’s provisioning dialogue was pinned here too; the cli/guard
  // interface left the catalog with the analyze-only corpus (2026-08-10), so the
  // branch-and-loop coverage rides `config llm setup` above.

  it('orders `analyze`’s own questions after the wizard it may open with', () => {
    const analyze = command('truecourse analyze')
    const sequence = analyze.sequence as InterfaceSequenceNode[]
    // Observed live: the skills offer, then the dirty-tree choice, then the
    // LLM-rule confirm — the wizard's questions all sit between them and the top.
    expect(sequence.slice(-3).map((n) => n.prompt)).toEqual([
      'New Claude Code skill(s) available:',
      'How should TrueCourse handle them?',
      'Run LLM-powered rules?',
    ])
    expect(sequence.slice(-3).every((n) => n.after === undefined)).toBe(true)
  })

  it('the original identities are exactly where they were — a new interface is ADDITIVE', () => {
    // Literals, not a self-check: row grammar and prompt encoding landed in this
    // catalog, and not one existing scenario may be re-authored for them. The
    // `cli/spec` + `cli/guard` trees joined (2026-08-09) and left again with the
    // analyze-only corpus (2026-08-10). A moved digit here IS the regression —
    // EXCEPT where the entry itself changed shape, which is the next test.
    const fingerprints = Object.fromEntries(catalog.interfaces.map((j) => [j.id, j.fingerprint]))
    // The four one-command entries: their entry and their single step are
    // untouched by the granularity split, so their identities are the originals.
    expect(fingerprints['cli/add']).toBe(
      'sha256:61d9dd0c58f542195f6305faa593fc5ee2fc8de203fac212df3c86d442beb0a4',
    )
    expect(fingerprints['cli/analyze']).toBe(
      'sha256:66792fe9ce97d69aa7a54ecd634d57f145eebe1d89de01e7f2f4aedc0dc232b8',
    )
    expect(fingerprints['cli/list']).toBe(
      'sha256:b7b34908386f2c205afb3ab048ed34ebca96cd05f9ae0622025f613a45c574e8',
    )
    expect(fingerprints['cli/root']).toBe(
      'sha256:816d25a9ace7be600d9664a00ede4f1e461c89530d18667feb5f35be022e3757',
    )
    // 114 after the dashboard CLI and Code Analysis web waves. No two interfaces
    // share an identity — an operation, a command and a page task never can, and
    // two tasks rooted at the same route are told apart by their steps.
    expect(new Set(Object.values(fingerprints)).size).toBe(114)
  })

  it('the three multi-command trees moved — one entry per command, and the group holds them', () => {
    // RE-PINNED 2026-08-10 for the INTERFACE granularity split, and for nothing
    // else: `cli/config`, `cli/hooks` and `cli/rules` used to be TREES whose steps
    // enumerated every subcommand, so each now fingerprints over its own single
    // invoke step and its siblings are entries of their own. The identity rule did
    // not change — type + entry + steps, as always; the steps did.
    const fingerprints = Object.fromEntries(catalog.interfaces.map((j) => [j.id, j.fingerprint]))
    expect(fingerprints['cli/config']).toBe(
      'sha256:c0a7dbb283265d819eaccaff5b283923c4ca158b52f5cdc651a12dbe534f2cd2',
    )
    expect(fingerprints['cli/hooks']).toBe(
      'sha256:7d98b8d4f49b5488a448aa7b19345aa977ae93fc3a0ea7222659efef829224dd',
    )
    expect(fingerprints['cli/rules']).toBe(
      'sha256:96a4ef6562d4664c6a3e4fda5108111fb5800f5b60f8cd86c7a6eb8e0111f64a',
    )
    // Every cli entry is ONE invocable command: one step, one contract command,
    // and the step's argv IS the entry.
    for (const iface of cli) {
      const entry = iface.entry
      if (!('command' in entry)) throw new Error(`${iface.id} is not command-rooted`)
      expect(iface.steps, iface.id).toHaveLength(1)
      expect(iface.steps[0]).toMatchObject({ kind: 'invoke', command: entry.command })
      expect(iface.contract!.commands, iface.id).toHaveLength(1)
      const argv = iface.contract!.commands[0].path
      expect(argv.slice(-entry.command.length), iface.id).toEqual(entry.command)
    }
    // The families the split left behind — the group is the only thing that says
    // which entries belong to one tree, and every entry states one.
    expect(catalog.interfaces.every((j) => j.group !== undefined)).toBe(true)
    const byGroup = (group: string) => cli.filter((j) => j.group === group).map((j) => j.id)
    expect(byGroup('rules')).toEqual([
      'cli/rules',
      'cli/rules-categories',
      'cli/rules-llm',
      'cli/rules-list',
      'cli/rules-enable',
      'cli/rules-disable',
      'cli/rules-reset',
    ])
    expect(byGroup('config')).toEqual([
      'cli/config',
      'cli/config-llm',
      'cli/config-llm-setup',
      'cli/config-llm-show',
      'cli/config-llm-test',
      'cli/config-llm-use',
    ])
    expect(byGroup('hooks')).toEqual([
      'cli/hooks',
      'cli/hooks-install',
      'cli/hooks-uninstall',
      'cli/hooks-status',
      'cli/hooks-run',
    ])
    // An api entry's group is its route family, a web task's is the page it acts on.
    const groupOf = (id: string) => catalog.interfaces.find((j) => j.id === id)!.group
    expect(groupOf('api/get-api-repos-id-analyses-analysisid-usage')).toBe('analyses')
    expect(groupOf('api/put-api-repos-id-graph-positions')).toBe('graph')
    expect(groupOf('api/get-api-rules')).toBe('rules')
    expect(groupOf('web/open-repo-report')).toBe('home')
    expect(groupOf('web/silence-rule-from-violation-card')).toBe('repos')
  })

  /**
   * The api surface — the dashboard server's HTTP routes, added 2026-08-10 as a
   * REALIZATION surface (plan §2: interfaces realize, never originate). Derived from
   * the route registrations under `apps/dashboard/server/src/routes/`, narrowed to
   * what the client really calls while serving the Code Analysis section plus the
   * repo-level plumbing around it. What is pinned here is the SHAPE the derivation
   * has to produce for an operation, since nothing else in the corpus fixes it.
   */
  describe('the api surface', () => {
    const api = catalog.interfaces.filter((j) => j.type === 'api')
    const operation = (id: string) => api.find((j) => j.id === id)!
    const contractOf = (id: string) => operation(id).contract!.commands[0]

    it('is 32 operations, each rooted at its own method + path', () => {
      expect(api).toHaveLength(32)
      for (const iface of api) {
        // Operation-rooted: the entry is the method/path pair, never an argv path.
        const entry = iface.entry
        if (!('method' in entry)) throw new Error(`${iface.id} is not operation-rooted`)
        expect(interfaceEntryLabel(entry), iface.id).toBe(iface.title)
        // One request step, and it restates the entry — an operation is not a tree,
        // so the catalog's per-command steps have nothing to enumerate here.
        expect(iface.steps, iface.id).toHaveLength(1)
        expect(iface.steps[0]).toEqual({ kind: 'request', method: entry.method, path: entry.path })
        // …and exactly one contract entry, keyed the same way.
        const commands = iface.contract!.commands
        expect(commands, iface.id).toHaveLength(1)
        expect(commands[0].path.join(' '), iface.id).toBe(iface.title)
      }
    })

    it('canonicalizes every express param into the `{name}` form', () => {
      // The identity rule of `canonicalRoutePath`: an operation has ONE identity
      // whichever side declared it, so `:id` never survives into an interface.
      for (const iface of api) {
        const entry = iface.entry
        if (!('method' in entry)) throw new Error(`${iface.id} is not operation-rooted`)
        expect(entry.path, iface.id).toBe(canonicalRoutePath(entry.path))
        expect(entry.path.includes(':'), iface.id).toBe(false)
      }
      expect(operation('api/get-api-repos-id-databases-dbid-schema').entry).toEqual({
        method: 'GET',
        path: '/api/repos/{id}/databases/{dbId}/schema',
      })
    })

    it('carries a path parameter as a positional and a query or body field as an option', () => {
      // 33 positionals over 32 operations: `{id}` on all 29 repo-scoped ones, plus
      // the five second params (`analysisId` twice, `dbId`, `flowId`, `ruleKey`),
      // and none at all on `/api/capabilities` and `/api/rules`.
      expect(api.reduce((n, j) => n + j.contract!.commands[0].positionals!.length, 0)).toBe(33)
      expect(contractOf('api/get-api-rules').positionals).toEqual([])
      expect(contractOf('api/patch-api-repos-id-rules-rulekey').positionals!.map((p) => p.name)).toEqual([
        'id',
        'ruleKey',
      ])
      expect(contractOf('api/get-api-capabilities').positionals).toEqual([])
      expect(
        contractOf('api/get-api-repos-id-analyses-analysisid-usage').positionals!.map((p) => p.name),
      ).toEqual(['id', 'analysisId'])

      // The grammar of the busiest read surface, complete: its five filters and
      // the two paging parameters, with the value sets the code really enforces.
      const violations = contractOf('api/get-api-repos-id-violations')
      expect(violations.options!.map((o) => o.flag)).toEqual([
        'analysisId',
        'file',
        'status',
        'severity',
        'limit',
        'offset',
      ])
      expect(violations.options!.find((o) => o.flag === 'status')!.choices).toEqual([
        'active',
        'resolved',
        'all',
      ])
      expect(violations.options!.find((o) => o.flag === 'status')!.default).toBe('active')
      expect(violations.options!.find((o) => o.flag === 'severity')!.choices).toEqual([
        'critical',
        'high',
        'medium',
        'low',
        'info',
      ])

      // A request BODY has no region of its own in the schema, so its fields ride
      // the grammar with their location stated in the description — the one place
      // the transform is lossy, recorded as G65 in `reference/transform-gaps.md`.
      const analyze = contractOf('api/post-api-repos-id-analyses')
      expect(analyze.options!.map((o) => o.flag)).toEqual(['mode', 'skipGit'])
      expect(analyze.options!.find((o) => o.flag === 'mode')!.choices).toEqual(['full', 'diff'])
      expect(analyze.options!.every((o) => o.description!.startsWith('JSON body field.'))).toBe(true)
      expect(
        contractOf('api/get-api-repos-id-violations').options!.every((o) =>
          o.description!.startsWith('Query parameter.'),
        ),
      ).toBe(true)
    })

    it('records the two defaults that differ between the graph routes', () => {
      // The trap a scenario author walks into: `level` is `services` everywhere
      // except the collapsed PUT, where it is `modules`.
      const level = (id: string) => contractOf(id).options!.find((o) => o.flag === 'level')!.default
      expect(level('api/get-api-repos-id-graph')).toBe('services')
      expect(level('api/put-api-repos-id-graph-positions')).toBe('services')
      expect(level('api/delete-api-repos-id-graph-positions')).toBe('services')
      expect(level('api/put-api-repos-id-graph-collapsed')).toBe('modules')
      // And the one graph route that reads `branch` at all.
      const hasBranch = (id: string) => contractOf(id).options!.some((o) => o.flag === 'branch')
      expect(hasBranch('api/delete-api-repos-id-graph-positions')).toBe(true)
      expect(hasBranch('api/get-api-repos-id-graph')).toBe(false)
      expect(hasBranch('api/put-api-repos-id-graph-positions')).toBe(false)
      expect(hasBranch('api/put-api-repos-id-graph-collapsed')).toBe(false)
      // …while all four analytics reads DO read it — the same parameter name,
      // honoured on one family and ignored on the other.
      for (const id of [
        'api/get-api-repos-id-analytics-trend',
        'api/get-api-repos-id-analytics-breakdown',
        'api/get-api-repos-id-analytics-top-offenders',
        'api/get-api-repos-id-analytics-resolution',
      ]) {
        expect(hasBranch(id), id).toBe(true)
      }
    })

    it('states a response status as an exit fact, one per condition', () => {
      // 112 statuses over 32 operations. An operation's HTTP status has no fact kind
      // of its own; it rides `exits`, whose field is deliberately a STRING (G66).
      expect(api.reduce((n, j) => n + j.contract!.commands[0].io!.produces!.exits!.length, 0)).toBe(112)
      const exits = (id: string) =>
        contractOf(id).io!.produces!.exits!.map((e) => e.exit)
      expect(exits('api/post-api-repos')).toEqual(['201', '400', '401', '500'])
      expect(exits('api/delete-api-repos-id')).toEqual(['204', '404', '401', '500'])
      expect(exits('api/post-api-repos-id-analyses')).toEqual(['202', '400', '404', '401', '500'])
      expect(exits('api/get-api-repos-browse')).toEqual(['200', '400', '403', '404', '401', '500'])
      // The gate above every `/api` route — and the one route mounted above IT.
      const gated = api.filter((j) =>
        j.contract!.commands[0].io!.produces!.exits!.some((e) => e.exit === '401'),
      )
      expect(gated).toHaveLength(31)
      expect(exits('api/get-api-capabilities')).toEqual(['200'])
      // `/api/rules` takes no project, so its only other answer is the gate's.
      expect(exits('api/get-api-rules')).toEqual(['200', '401'])
      // A rule key that names nothing shares the 404 with an unknown project.
      expect(exits('api/patch-api-repos-id-rules-rulekey')).toEqual(['200', '400', '404', '401'])
    })

    it('names the store files each route reads, and the write the resolver does behind it', () => {
      // The resolver's `lastOpened` touch is a real write on every project-scoped
      // request, so every one of those contracts carries it — 23 of the 32, the
      // ones mounted under `projectResolver`; the eight on the repos router,
      // `/api/capabilities` and `/api/rules` are mounted without it.
      const touching = api.filter((j) =>
        j.contract!.commands[0].io!.produces!.writes!.some(
          (w) => w.path === '~/.truecourse/registry.json' && w.when!.includes('lastOpened'),
        ),
      )
      expect(touching).toHaveLength(23)
      expect(
        contractOf('api/get-api-repos-id-violations').io!.consumes!.reads!.map((r) => r.path),
      ).toEqual([
        '~/.truecourse/registry.json',
        '<repo>/.truecourse/LATEST.json',
        '<repo>/.truecourse/analyses/<iso>_<short-uuid>.json',
        '<repo>/.truecourse/config.json',
      ])
      // The trigger is the one Code Analysis route that writes the analyze store.
      const analyze = contractOf('api/post-api-repos-id-analyses').io!.produces!.writes!.map((w) => w.path)
      expect(analyze).toContain('<repo>/.truecourse/.analyze.lock')
      expect(analyze).toContain('<repo>/.truecourse/LATEST.json')
      expect(analyze).toContain('<repo>/.truecourse/history.json')
      expect(analyze).toContain('git stash')
      // Reading is not writing: a read route's only write is the resolver's touch.
      expect(contractOf('api/get-api-repos-id-graph').io!.produces!.writes!).toHaveLength(1)
      // …and the four read routes mounted WITHOUT the resolver write nothing at
      // all (the other two unscoped ones, the create and the delete, write on
      // purpose).
      for (const id of [
        'api/get-api-capabilities',
        'api/get-api-repos',
        'api/get-api-repos-browse',
        'api/get-api-repos-id',
        'api/get-api-repos-id-rules',
        'api/get-api-rules',
      ]) {
        expect(contractOf(id).io!.produces!.writes!, id).toEqual([])
      }
      // The rule toggle is the one mapped write that never leaves the project's
      // own config — no store file, no registry entry.
      expect(contractOf('api/patch-api-repos-id-rules-rulekey').io!.produces!.writes!).toEqual([
        {
          path: '<repo>/.truecourse/config.json',
          when: '`disabledRules`, re-sorted on every write',
        },
      ])
    })

    it('carries the response shape as markers, never a schema', () => {
      const markers = (id: string) =>
        contractOf(id).io!.produces!.output!.map((o) => o.marker)
      expect(markers('api/get-api-capabilities')).toContain('"edition"')
      expect(markers('api/get-api-repos-id-violations-summary')).toEqual([
        '"total"',
        '"byFile"',
        '"bySeverity"',
        '"highestSeverityByFile"',
        'not found',
        '"error"',
      ])
      // The one envelope every failing route answers with.
      const envelope = api.filter((j) =>
        j.contract!.commands[0].io!.produces!.output!.some((o) => o.marker === '"error"'),
      )
      expect(envelope).toHaveLength(31)
      // The two rule routes answer the same rows and differ in ONE promise, which
      // is the only reason both exist — so both say it, on the field it is about.
      const enabledWhen = (id: string) =>
        contractOf(id).io!.produces!.output!.find((o) => o.marker === '"enabled"')!.when!
      expect(enabledWhen('api/get-api-repos-id-rules')).toContain('disabledRules')
      expect(enabledWhen('api/get-api-rules')).toContain('SHIPPED default')
      // A response body is not a stream; the runner already carries an api response
      // as the cli `stdout` analog, and the contract follows it (G67).
      const streams = new Set(
        api.flatMap((j) => j.contract!.commands[0].io!.produces!.output!.map((o) => o.stream)),
      )
      expect([...streams]).toEqual(['stdout'])
    })

    it('has an identity per operation, derived exactly as a cli interface’s is', () => {
      // Literals, not a self-check — the same rule the cli seven live by. These are
      // what an api scenario would ground on, so a moved digit here re-authors it.
      expect(Object.fromEntries(api.map((j) => [j.id, j.fingerprint]))).toEqual({
        'api/get-api-capabilities':
          'sha256:35671d6e8a1da21d5d4fabf7b03e39607cea68e7ce3c031377faa655e43f0b97',
        'api/post-api-repos':
          'sha256:2d10b8ff8cd812c404917d27ef0b89f58cba8f409eb85f1594cecb9f539f6e90',
        'api/get-api-repos':
          'sha256:288caeaef838019c725acf5bad3eb1aa8d4d883311e00de99d84a000164952c1',
        'api/get-api-repos-browse':
          'sha256:f64324d3e86508ed41e97231a1a4e89a5f9074ad29484eaddece2f213724360a',
        'api/get-api-repos-id':
          'sha256:8139eb21d780082c7142d762043d3b9b4ab81bcbe882c6f517e5bbbbc1d0895b',
        'api/delete-api-repos-id':
          'sha256:37af64e610f65cff6459bd51e6674e8b7337b891bd32d16a1233a852d1edb047',
        'api/post-api-repos-id-analyses':
          'sha256:e2c66d7da2225688a8ab85384cca3038b3c89badf18f54953b39de22ee0fd816',
        'api/post-api-repos-id-analyses-cancel':
          'sha256:8f42693c90bb9a0a813dd872cd0ad18f94c8cad403dc9ebc636bde47c7ae5235',
        'api/get-api-repos-id-analyses':
          'sha256:9f14c34aa3bce7a0b7a932adbcacac3414f81efcbb05332005a13d4d338449a1',
        'api/get-api-repos-id-analyses-diff':
          'sha256:cab585f7169ec4e0f8071567521d233d19ee5f7a0e7de10d852b334e478ca586',
        'api/get-api-repos-id-analyses-analysisid-usage':
          'sha256:91344d31894b1c12d94356e93a840830605cc9adcefc201bf01d9eb949afcb17',
        'api/delete-api-repos-id-analyses-analysisid':
          'sha256:6424604b6da85b9e841bc352d62d4887f3c6d81b935e6d7a4ea21dcc32b303f5',
        'api/get-api-repos-id-graph':
          'sha256:83cb22b0c26aeab4dc33b3c0264dd45af164c1897d2fa2433082834d93610daa',
        'api/put-api-repos-id-graph-positions':
          'sha256:fc644efd752ca011eb5aa2793df28da61cc477223e8ea24eac9a641737e159fb',
        'api/delete-api-repos-id-graph-positions':
          'sha256:c16f6bf87d69f8ba1582c1d25d14b3a18ac1b520e3c1e386695b1b6446d4145c',
        'api/put-api-repos-id-graph-collapsed':
          'sha256:9661b1e171eb70e9529c93a566070748ca0b5aa96ef37941c6106fe0b5be7d31',
        'api/get-api-repos-id-files':
          'sha256:de470bf9a75200f2934206421bda1344a0afe63d85d5f63505979b2bf07bcfad',
        'api/get-api-repos-id-file-content':
          'sha256:1e6872db20b7b3cb33ffeb6af89b08938de05c15d3d4e5cb7965f2430128f669',
        'api/get-api-repos-id-violations':
          'sha256:3b451a118147cc0a8bdb70612625b77ea367536f7a04b7921d97bdaa39738b02',
        'api/get-api-repos-id-violations-summary':
          'sha256:b0e7efb3a7cec634dc26a5411d615d13fa03f29d51076f0aa6561974658012dd',
        'api/get-api-repos-id-databases':
          'sha256:b2443cee1c0ac52dfa88bca0dd213539265f7fb492ed38bdcbdba0428c61e669',
        'api/get-api-repos-id-databases-dbid-schema':
          'sha256:6e14e97deee5dd83251e680858d732b46be32d8d3086ff359eb626cf352ed00b',
        'api/get-api-repos-id-flows':
          'sha256:bf247f29aeda1c55b3cbb214d494a4b2f33c2b4b454ebb8d5d1141e1ffb66c41',
        'api/get-api-repos-id-flows-flowid':
          'sha256:2c194b630858971100167dd46889b7aac43153a0f328ce55e8c575f3df44a941',
        'api/post-api-repos-id-flows-flowid-enrich':
          'sha256:99023d433bff55e68647d4adae6570bb79b1c7daf17e339b08b629c35d862b13',
        'api/get-api-repos-id-rules':
          'sha256:dfafa6540da39d72e15e6872c15dd11a557df83a196c2cf356cafd34f3e70678',
        'api/patch-api-repos-id-rules-rulekey':
          'sha256:29cd80ceb08a38601d27a8c728d9d9c8dc810971e064349ddd75cab971cbe821',
        'api/get-api-repos-id-analytics-trend':
          'sha256:365626aaf7ec913b9c51d6b315ad7b04e1058e931f311680edf4857b433d7cd5',
        'api/get-api-repos-id-analytics-breakdown':
          'sha256:739fdb17d885ac61cba1871b29aeadec5cac6a33e6495afb21dff9993cef5e2f',
        'api/get-api-repos-id-analytics-top-offenders':
          'sha256:20d30c8fda90f6423876dc6b99ee8c4fa849502a5a9477da7e58bd99b961c8f5',
        'api/get-api-repos-id-analytics-resolution':
          'sha256:88225bec5506b91017f0b37c335b03e03a126cd6672764fcb48cd85e58e9a8f6',
        'api/get-api-rules':
          'sha256:d3bf12f18ab99c3f23a31127abf9ff58518a01128ee06f238460056e4a25ad0c',
      })
    })
  })
})

describe('interfaceEntryLabel', () => {
  it('labels a command entry as its argv path and an operation entry as METHOD path', () => {
    expect(interfaceEntryLabel({ command: ['tasks', 'add'] })).toBe('tasks add')
    expect(interfaceEntryLabel({ method: 'get', path: '/todos/{id}' })).toBe('GET /todos/{id}')
  })
})

describe('canonicalRoutePath', () => {
  it('converts every framework param syntax to {name}', () => {
    expect(canonicalRoutePath('/todos/:id')).toBe('/todos/{id}')
    expect(canonicalRoutePath('/todos/<id>')).toBe('/todos/{id}')
    expect(canonicalRoutePath('/todos/<int:id>')).toBe('/todos/{id}')
    expect(canonicalRoutePath('/todos/{id}')).toBe('/todos/{id}')
    expect(canonicalRoutePath('/todos/{id:guid}')).toBe('/todos/{id}')
  })

  it('ensures a leading slash and drops trailing slashes; the root path survives', () => {
    expect(canonicalRoutePath('todos')).toBe('/todos')
    expect(canonicalRoutePath('/todos/')).toBe('/todos')
    expect(canonicalRoutePath('/')).toBe('/')
  })
})
