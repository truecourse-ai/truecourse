import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  JOURNEY_UNKNOWN,
  JourneyContractSchema,
  JourneyOptionSchema,
  JourneyPromptFactSchema,
  JourneyPromptSubmitSchema,
  JourneyReadFactSchema,
  JourneyRowFactSchema,
  JourneyRowRoleSchema,
  JourneySchema,
  JourneySlotKindSchema,
  JourneyStepSchema,
  JourneyStepKindSchema,
  JourneysFileSchema,
  canonicalRoutePath,
  journeyEntryLabel,
  journeyFingerprint,
  guardDriverIds,
  type Journey,
  type JourneyContract,
  type JourneyStep,
} from '@truecourse/shared'

function journey(steps: JourneyStep[], over: Partial<Journey> = {}): Journey {
  const base = {
    id: 'cli/tasks-add',
    type: 'cli' as const,
    title: 'tasks add',
    entry: { command: ['tasks', 'add'] },
    steps,
    ...over,
  }
  return { ...base, fingerprint: journeyFingerprint(base) }
}

const INVOKE: JourneyStep = { kind: 'invoke', command: ['tasks', 'add'], flags: ['--json', '--force'] }
const REQUEST: JourneyStep = { kind: 'request', method: 'POST', path: '/tasks' }
const NAVIGATE: JourneyStep = { kind: 'navigate', route: '/board' }
const INPUT: JourneyStep = { kind: 'input', target: 'TaskBoard::titleField' }
const ACTIVATE: JourneyStep = { kind: 'activate', target: 'TaskBoard::addButton' }

describe('journey schemas', () => {
  it('the step vocabulary is the closed five-kind set', () => {
    expect(JourneyStepKindSchema.options).toEqual(['invoke', 'request', 'navigate', 'input', 'activate'])
  })

  it('parses every step kind', () => {
    for (const step of [INVOKE, REQUEST, NAVIGATE, INPUT, ACTIVATE]) {
      expect(() => JourneyStepSchema.parse(step)).not.toThrow()
    }
  })

  it('rejects an unknown kind and a payload from the wrong kind', () => {
    expect(() => JourneyStepSchema.parse({ kind: 'scroll', target: 'x' })).toThrow()
    expect(() => JourneyStepSchema.parse({ kind: 'navigate', target: 'x' })).toThrow()
    expect(() => JourneyStepSchema.parse({ kind: 'request', method: 'GET' })).toThrow()
  })

  it('defaults invoke flags to []', () => {
    expect(JourneyStepSchema.parse({ kind: 'invoke', command: ['tasks'] })).toEqual({
      kind: 'invoke',
      command: ['tasks'],
      flags: [],
    })
  })

  it('a journey type is a driver-registry id', () => {
    expect(guardDriverIds).toContain('desktop')
    expect(() => JourneySchema.parse(journey([NAVIGATE], { type: 'mobile' }))).not.toThrow()
    expect(() => JourneySchema.parse({ ...journey([INVOKE]), type: 'smoke-signal' })).toThrow()
  })

  it('a journey needs at least one step', () => {
    expect(() => JourneySchema.parse({ ...journey([INVOKE]), steps: [] })).toThrow()
  })

  it('round-trips a journeys file through JSON', () => {
    const file = {
      version: 1 as const,
      generatedAt: '2026-07-24T12:00:00.000Z',
      recipeFingerprint: 'sha256:recipe',
      journeys: [journey([INVOKE]), journey([REQUEST], { id: 'api/create-task', type: 'api', entry: { method: 'POST', path: '/tasks' } })],
    }
    expect(JourneysFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file)
  })

  it('an entry is command-rooted OR operation-rooted, never a mix', () => {
    expect(() =>
      JourneySchema.parse(journey([REQUEST], { type: 'api', entry: { method: 'POST', path: '/tasks' } })),
    ).not.toThrow()
    expect(() => JourneySchema.parse({ ...journey([REQUEST]), entry: { method: 'POST' } })).toThrow()
    expect(() =>
      JourneySchema.parse({ ...journey([REQUEST]), entry: { command: ['x'], method: 'POST', path: '/t' } }),
    ).toThrow()
  })

  it('specOnly is optional provenance — only literal true parses', () => {
    const specOnly = { ...journey([REQUEST], { type: 'api', entry: { method: 'GET', path: '/t' } }), specOnly: true as const }
    expect(JourneySchema.parse(specOnly).specOnly).toBe(true)
    expect(JourneySchema.parse(journey([INVOKE])).specOnly).toBeUndefined()
    expect(() => JourneySchema.parse({ ...specOnly, specOnly: false })).toThrow()
  })

  it('records per-surface how the catalog was derived, and tolerates its absence', () => {
    const base = {
      version: 1 as const,
      generatedAt: '2026-07-24T12:00:00.000Z',
      recipeFingerprint: 'sha256:recipe',
      journeys: [journey([INVOKE])],
    }
    expect(JourneysFileSchema.parse({ ...base, source: { cli: 'probes' } }).source).toEqual({
      cli: 'probes',
    })
    expect(JourneysFileSchema.parse(base).source).toBeUndefined()
    expect(() => JourneysFileSchema.parse({ ...base, source: { cli: 'guessed' } })).toThrow()
  })
})

describe('journeyFingerprint', () => {
  const fp = (steps: JourneyStep[], over: Partial<Journey> = {}): string =>
    journeyFingerprint({ type: 'cli', entry: { command: ['tasks', 'add'] }, steps, ...over })

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
      journeyFingerprint({ type: 'api', entry: { method, path }, steps: [REQUEST] })
    expect(op('post', '/tasks')).toBe(op('POST', '/tasks'))
    expect(op('PUT', '/tasks')).not.toBe(op('POST', '/tasks'))
    expect(op('POST', '/tasks/{id}')).not.toBe(op('POST', '/tasks'))
  })

  it('specOnly is provenance, never identity', () => {
    const shape = { type: 'api' as const, entry: { method: 'GET' as const, path: '/t' }, steps: [REQUEST] }
    expect(journeyFingerprint(shape)).toBe(journeyFingerprint({ ...shape }))
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

const CONTRACT: JourneyContract = {
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
            { exit: JOURNEY_UNKNOWN, when: 'the store is unwritable — no exit path is declared in code' },
          ],
          writes: [{ path: '~/.tasks.json', when: 'always' }],
        },
      },
    },
  ],
}

describe('the journey contract', () => {
  it('parses a journey carrying the full contract', () => {
    const rich = { ...journey([INVOKE]), contract: CONTRACT }
    const parsed = JourneySchema.parse(JSON.parse(JSON.stringify(rich)))
    expect(parsed).toEqual(rich)
  })

  it('a catalog that carries only the command tree still parses — the growth is additive', () => {
    // Byte-for-byte the shape the mapper writes today: no contract.
    const engineWritten = {
      version: 1 as const,
      generatedAt: '2026-08-06T12:00:00.000Z',
      recipeFingerprint: 'sha256:recipe',
      journeys: [journey([INVOKE])],
      source: { cli: 'tree' as const },
    }
    const parsed = JourneysFileSchema.parse(JSON.parse(JSON.stringify(engineWritten)))
    expect(parsed).toEqual(engineWritten)
    expect(parsed.journeys[0].contract).toBeUndefined()
  })

  it('round-trips a contract-bearing catalog through JSON unchanged', () => {
    const file = {
      version: 1 as const,
      generatedAt: '2026-08-06T12:00:00.000Z',
      recipeFingerprint: 'sha256:recipe',
      journeys: [{ ...journey([INVOKE]), contract: CONTRACT }],
      source: { cli: 'tree' as const },
    }
    expect(JourneysFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file)
  })

  it('keeps "established as none" and "never established" apart', () => {
    const none = JourneyContractSchema.parse({
      commands: [{ path: ['tasks'], subcommands: [], io: { consumes: { prompts: [] }, produces: { writes: [] } } }],
    })
    // Authored empty lists survive as empty lists — they say "none", out loud.
    expect(none.commands[0].io?.consumes?.prompts).toEqual([])
    expect(none.commands[0].io?.produces?.writes).toEqual([])
    expect(none.commands[0].subcommands).toEqual([])
    // A field nobody established stays absent — never coerced into an empty "none".
    const bare = JourneyContractSchema.parse({ commands: [{ path: ['tasks'] }] })
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
    expect(JourneyReadFactSchema.parse({ path: '~/.tasks.json' })).toEqual({ path: '~/.tasks.json' })
    expect(() => JourneyReadFactSchema.parse({ path: '' })).toThrow()
    expect(() => JourneyReadFactSchema.parse({ path: '~/.tasks.json', when: '' })).toThrow()

    // "Reads nothing" and "nobody established what it reads" stay different reads.
    const none = JourneyContractSchema.parse({ commands: [{ path: ['tasks'], io: { consumes: { reads: [] } } }] })
    expect(none.commands[0].io?.consumes?.reads).toEqual([])
    const bare = JourneyContractSchema.parse({ commands: [{ path: ['tasks'], io: { consumes: { prompts: [] } } }] })
    expect(bare.commands[0].io?.consumes?.reads).toBeUndefined()
  })

  it('records an unestablished exit status as `unknown` rather than a plausible number', () => {
    const exits = CONTRACT.commands[0].io?.produces?.exits ?? []
    expect(exits.map((e) => e.exit)).toContain(JOURNEY_UNKNOWN)
    expect(JOURNEY_UNKNOWN).toBe('unknown')
  })

  it('an option default is any scalar the registration declares', () => {
    for (const value of ['low', 20, true]) {
      const parsed = JourneyOptionSchema.parse({
        flag: '--x',
        takesValue: true,
        valueRequired: false,
        default: value,
      })
      expect(parsed.default).toBe(value)
    }
    expect(() =>
      JourneyOptionSchema.parse({ flag: '--x', takesValue: true, valueRequired: false, default: ['a'] }),
    ).toThrow()
  })

  it('is strict about its own vocabulary', () => {
    // Requiredness is not optional — a grammar entry that omits it is not a grammar.
    expect(() => JourneyOptionSchema.parse({ flag: '--x', takesValue: true })).toThrow()
    expect(() => JourneyOptionSchema.parse({ flag: '--x', takesValue: true, valueRequired: false, scope: 'shell' })).toThrow()
    expect(() => JourneyOptionSchema.parse({ flag: '--x', takesValue: true, valueRequired: false, required: true })).toThrow()
    expect(() => JourneyContractSchema.parse({ commands: [] })).toThrow()
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
    expect(JourneyRowRoleSchema.options).toEqual(['header', 'row', 'footer'])
    for (const role of JourneyRowRoleSchema.options) {
      expect(() => JourneyRowFactSchema.parse(rowFact({ role }))).not.toThrow()
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
      expect(() => JourneyRowFactSchema.parse(rowFact({ template, slots }))).not.toThrow()
    }
  })

  it('the slot vocabulary is the closed three-member set, and `values` belongs to `enum`', () => {
    expect(JourneySlotKindSchema.options).toEqual(['count', 'enum', 'text'])
    // An enum without its value set says no more than text does.
    expect(() =>
      JourneyRowFactSchema.parse(rowFact({ slots: [{ name: 'state', kind: 'enum' }, { name: 'title', kind: 'text' }] })),
    ).toThrow()
    // …and a value set on a count or a free string is a claim nobody established.
    expect(() =>
      JourneyRowFactSchema.parse(
        rowFact({ slots: [{ name: 'state', kind: 'enum', values: ['todo'] }, { name: 'title', kind: 'count', values: ['1'] }] }),
      ),
    ).toThrow()
    expect(() => JourneyRowFactSchema.parse(rowFact({ slots: [{ name: 'state', kind: 'colour', values: ['red'] }] }))).toThrow()
  })

  it('the template and its slots must agree exactly — neither can promise what the other lacks', () => {
    // A placeholder no slot describes: the template promises a value with no vocabulary.
    expect(() => JourneyRowFactSchema.parse(rowFact({ template: '<state>  <title>  <due>' }))).toThrow()
    // A slot the line never prints: a vocabulary with nothing to fill.
    expect(() =>
      JourneyRowFactSchema.parse(rowFact({ template: '<state>', slots: [{ name: 'state', kind: 'text' }, { name: 'title', kind: 'text' }] })),
    ).toThrow()
    // The same name twice in one declaration.
    expect(() =>
      JourneyRowFactSchema.parse(rowFact({ template: '<title> <title>', slots: [{ name: 'title', kind: 'text' }, { name: 'title', kind: 'count' }] })),
    ).toThrow()
    // A template may REPEAT a slot, though — one vocabulary, two positions.
    expect(() =>
      JourneyRowFactSchema.parse(rowFact({ template: '<n> of <n>', slots: [{ name: 'n', kind: 'count' }] })),
    ).not.toThrow()
    // A line with no slots at all is a marker, not a shape.
    expect(() => JourneyRowFactSchema.parse(rowFact({ template: 'Done.', slots: [] }))).toThrow()
    // And it stays strict about its own vocabulary.
    expect(() => JourneyRowFactSchema.parse(rowFact({ columns: 3 }))).toThrow()
    expect(() => JourneyRowFactSchema.parse(rowFact({ role: 'total' }))).toThrow()
    expect(() => JourneyRowFactSchema.parse(rowFact({ when: '' }))).toThrow()
  })

  it('a prompt says HOW its answer is submitted, and the vocabulary is the two delivery classes', () => {
    expect(JourneyPromptSubmitSchema.options).toEqual(['enter', 'char'])
    expect(JourneyPromptFactSchema.parse({ kind: 'select', marker: 'Where?', submit: 'enter' }).submit).toBe('enter')
    expect(JourneyPromptFactSchema.parse({ kind: 'confirm', marker: 'Sure?', submit: 'char' }).submit).toBe('char')
    // Unestablished stays ABSENT — never rounded to a plausible default, because
    // a select answered as a keypress hangs and a keypress answered with a
    // trailing Enter answers the next question too.
    expect(JourneyPromptFactSchema.parse({ kind: 'text', marker: 'Name?' }).submit).toBeUndefined()
    expect(() => JourneyPromptFactSchema.parse({ kind: 'select', marker: 'Where?', submit: 'tab' })).toThrow()
    expect(() => JourneyPromptFactSchema.parse({ kind: 'select', marker: 'Where?', submit: '' })).toThrow()
  })

  it('the io vocabulary is facts only — every free-prose shape is rejected', () => {
    const io = (value: unknown) => () => JourneyContractSchema.parse({ commands: [{ path: ['tasks'], io: value }] })
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
      JourneyContractSchema.parse({ commands: [{ path: ['tasks'], ...value }] })
    // A sentence no fact kind carries is not stored anywhere, under any name:
    // it is either expressible as an exit/output/read/write/prompt fact, or gone.
    expect(() => command({ notes: ['Re-running creates a second task.'] })).toThrow()
    expect(() => command({ notes: [] })).toThrow()
    expect(() => command({ behavior: ['Re-running creates a second task.'] })).toThrow()
    expect(() => JourneyContractSchema.parse({ commands: [{ path: ['tasks'] }], notes: ['tree-wide'] })).toThrow()
    // What the note used to say lives on as a fact, or not at all.
    expect(() =>
      command({ io: { produces: { writes: [{ path: '~/.tasks.json', when: 're-running appends' }] } } }),
    ).not.toThrow()
  })

  it('carries the calling interface and nothing about itself', () => {
    const contract = (value: Record<string, unknown>) =>
      JourneyContractSchema.parse({ commands: [{ path: ['tasks'] }], ...value })
    // Provenance, authored decisions, doc-versus-code findings and the shared
    // block are not calling interface — they have no home in the artifact.
    expect(() => contract({ derivedFrom: ['src/cli.ts'] })).toThrow()
    expect(() => contract({ decisions: [{ id: 'x', decision: 'y' }] })).toThrow()
    expect(() => contract({ shared: { stdin: [] } })).toThrow()
    expect(() =>
      JourneyContractSchema.parse({ commands: [{ path: ['tasks'], inheritsShared: [{ block: 'stdin' }] }] }),
    ).toThrow()
    expect(() =>
      JourneySchema.parse({ ...journey([INVOKE]), diagnostics: [{ kind: 'k', subject: 's', detail: 'd' }] }),
    ).toThrow()
  })

  it('the CONTRACT never moves a journey identity — the invariant the whole growth rests on', () => {
    const bare = journey([INVOKE])
    const enriched = { ...bare, contract: CONTRACT }
    // Same shape in, same fingerprint out: grammar and io are what a command
    // TAKES, not which command it is.
    expect(journeyFingerprint(enriched)).toBe(bare.fingerprint)
    expect(journeyFingerprint(enriched)).toBe(journeyFingerprint(bare))
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
    expect(journeyFingerprint(relearned)).toBe(bare.fingerprint)
    // The surface itself still moves it — the fingerprint is not simply inert.
    expect(journeyFingerprint({ ...bare, steps: [{ ...INVOKE, flags: ['--json', '--quiet'] }] })).not.toBe(
      bare.fingerprint,
    )
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
  const file = path.resolve(__dirname, '../../reference/store/.truecourse/guard/journeys.json')
  const catalog = JourneysFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8')))
  const commands = (id: string) => catalog.journeys.find((j) => j.id === id)!.contract!.commands
  const reads = (id: string, commandPath: string) =>
    commands(id).find((c) => c.path.join(' ') === commandPath)!.io!.consumes!.reads!

  it('loads green, every contract included', () => {
    expect(catalog.journeys.map((j) => j.id)).toEqual([
      'cli/add',
      'cli/analyze',
      'cli/config',
      'cli/hooks',
      'cli/list',
      'cli/root',
      'cli/rules',
    ])
    // Every command of every tree now answers "what do I read?" — none is silent.
    const all = catalog.journeys.flatMap((j) => j.contract!.commands)
    expect(all).toHaveLength(22)
    expect(all.every((c) => c.io?.consumes?.reads !== undefined)).toBe(true)
    expect(all.reduce((n, c) => n + c.io!.consumes!.reads!.length, 0)).toBe(67)
  })

  it('is 100% structured facts — no command carries a sentence about behavior', () => {
    const all = catalog.journeys.flatMap((j) => j.contract!.commands)
    for (const command of all) {
      expect(Object.keys(command)).not.toContain('notes')
    }
    // The count the schema now guarantees: every io entry is one of the seven
    // fact kinds, and the corpus is 443 of them.
    const facts = all.reduce((n, c) => {
      const io = c.io ?? {}
      const sides = [io.consumes ?? {}, io.produces ?? {}]
      return n + sides.reduce((m, side) => m + Object.values(side).reduce((k, list) => k + list.length, 0), 0)
    }, 0)
    expect(facts).toBe(443)
  })

  it('carries the row grammar of every enumerated listing the CLI prints', () => {
    const rowsOf = (id: string, commandPath: string) =>
      commands(id).find((c) => c.path.join(' ') === commandPath)!.io!.produces!.rows!

    // The five commands whose output is a listing, plus `config llm show`'s
    // stage table — 25 shapes in all.
    const all = catalog.journeys.flatMap((j) => j.contract!.commands)
    expect(all.reduce((n, c) => n + (c.io?.produces?.rows?.length ?? 0), 0)).toBe(25)
    expect(rowsOf('cli/analyze', 'truecourse analyze')).toHaveLength(3)
    expect(rowsOf('cli/list', 'truecourse list')).toHaveLength(9)
    expect(rowsOf('cli/rules', 'truecourse rules categories')).toHaveLength(2)
    expect(rowsOf('cli/rules', 'truecourse rules llm')).toHaveLength(1)
    expect(rowsOf('cli/rules', 'truecourse rules list')).toHaveLength(5)
    expect(rowsOf('cli/config', 'truecourse config llm show')).toHaveLength(5)

    // The shapes the sufficiency audit named, each as ONE template + its slots.
    const templates = all.flatMap((c) => c.io?.produces?.rows ?? []).map((r) => r.template)
    expect(templates).toContain('Rules for <repo>: <shown> shown (<enabled> enabled, <disabled> disabled).')
    expect(templates).toContain('Showing <from>–<to> of <total> violations (<bySeverity>)')
    expect(templates).toContain('<icon> <severity>  <title>')
    expect(templates).toContain('<category> <status>')
    expect(templates).toContain('Summary: <new> new issues, <resolved> resolved')

    // A closed value set is carried by the slot, not hinted at in the template:
    // the enabled/disabled column is an `enum`, the counts are `count`.
    const category = rowsOf('cli/rules', 'truecourse rules categories')[1]
    expect(category.role).toBe('row')
    expect(category.slots.find((s) => s.name === 'status')).toEqual({
      name: 'status',
      kind: 'enum',
      values: ['enabled', 'disabled'],
    })
    const header = rowsOf('cli/rules', 'truecourse rules list')[0]
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
    const prompts = catalog.journeys
      .flatMap((j) => j.contract!.commands)
      .flatMap((c) => c.io?.consumes?.prompts ?? [])
    expect(prompts).toHaveLength(40)
    expect(prompts.every((p) => p.submit !== undefined)).toBe(true)
    // The two delivery classes the runner's terminal layer has, and which prompt
    // kind lands in which: a y/n confirm submits on the character itself.
    const byKind = new Map(prompts.map((p) => [p.kind, p.submit]))
    expect(Object.fromEntries(byKind)).toEqual({ select: 'enter', text: 'enter', confirm: 'char' })
  })

  it('carries the `config llm` family the audit found missing — grammar, prompts and all', () => {
    const config = commands('cli/config')
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
    const produces = (id: string, commandPath: string) =>
      commands(id).find((c) => c.path.join(' ') === commandPath)!.io!.produces!

    // "runs `git stash push` … and `git stash pop` after it" — a write a scenario
    // watches, so it survives as one; the log-only budget skip is a second write
    // on the same log, under its own condition.
    const analyze = produces('cli/analyze', 'truecourse analyze').writes!
    expect(analyze.map((w) => w.path)).toContain('git stash')
    expect(analyze.filter((w) => w.path === '<repo>/.truecourse/logs/analyze.log')).toHaveLength(2)

    // "`--version` … resolves on every subcommand … and exits 0" — an exit fact
    // whose condition names the scope, on the command that declares the flag.
    expect(produces('cli/root', 'truecourse').exits!.map((e) => e.when)).toContainEqual(
      expect.stringContaining('on ANY subcommand'),
    )

    // The `.git` walk the hook does before it reads anything — the state a
    // worktree scenario has to arrange.
    expect(reads('cli/hooks', 'truecourse hooks run')[0].path).toBe('<cwd ancestors>/.git')
  })

  it('puts every read fact on the command that reads it', () => {
    expect(reads('cli/add', 'truecourse add')).toHaveLength(5)
    expect(reads('cli/analyze', 'truecourse analyze')).toHaveLength(13)
    expect(commands('cli/hooks').map((c) => c.io!.consumes!.reads!.length)).toEqual([0, 2, 1, 2, 7])
    expect(reads('cli/list', 'truecourse list')).toHaveLength(5)

    // The condition survives the conversion; the prose gloss around it does not.
    expect(reads('cli/hooks', 'truecourse hooks run')).toContainEqual({
      path: 'git index',
      when: '`git diff --cached --name-only --diff-filter=ACM` — no staged files → pass',
    })
    expect(reads('cli/list', 'truecourse list').map((r) => r.path)).toContain('<repo>/.truecourse/diff.json')
  })

  it('folds the shared reads into every command that inherited them', () => {
    // The artifact has no shared block: the four facts the `rules` group stated
    // once are carried by each SUBcommand, and the group itself reads nothing.
    expect(commands('cli/rules').map((c) => c.io!.consumes!.reads!.length)).toEqual([0, 4, 4, 4, 4, 4, 4])
    for (const command of commands('cli/rules').slice(1)) {
      expect(command.io!.consumes!.reads!.map((r) => r.path)).toEqual([
        '<cwd ancestors>/.truecourse/',
        '~/.truecourse/registry.json',
        '<repo>/.truecourse/config.json',
        'built-in rule catalog',
      ])
    }
  })

  it('keeps "reads nothing" as an established fact, and every identity where it was', () => {
    // `truecourse` (root) reads no files at all — said out loud, not left absent.
    expect(reads('cli/root', 'truecourse')).toEqual([])
    // The whole point of the growth: enriching the contract rolls no journey.
    for (const journey of catalog.journeys) {
      expect(journeyFingerprint(journey)).toBe(journey.fingerprint)
    }
  })

  it('the six original identities are exactly where they were — a seventh journey is ADDITIVE', () => {
    // Literals, not a self-check: row grammar, prompt encoding and a whole new
    // `cli/config` journey landed in this catalog, and not one existing scenario
    // may be re-authored for it. A moved digit here IS the regression.
    const fingerprints = Object.fromEntries(catalog.journeys.map((j) => [j.id, j.fingerprint]))
    expect(fingerprints['cli/add']).toBe(
      'sha256:61d9dd0c58f542195f6305faa593fc5ee2fc8de203fac212df3c86d442beb0a4',
    )
    expect(fingerprints['cli/analyze']).toBe(
      'sha256:66792fe9ce97d69aa7a54ecd634d57f145eebe1d89de01e7f2f4aedc0dc232b8',
    )
    expect(fingerprints['cli/hooks']).toBe(
      'sha256:d46deb69bdb72e3221bf9395fc98b670c62aae96df97d8df07c5aa19fcc8dd70',
    )
    expect(fingerprints['cli/list']).toBe(
      'sha256:b7b34908386f2c205afb3ab048ed34ebca96cd05f9ae0622025f613a45c574e8',
    )
    expect(fingerprints['cli/root']).toBe(
      'sha256:816d25a9ace7be600d9664a00ede4f1e461c89530d18667feb5f35be022e3757',
    )
    expect(fingerprints['cli/rules']).toBe(
      'sha256:a1cb5505112364f829d0346050d74816873fbd3f73c3eedb7730015c7d1f4008',
    )
    // The new one has an identity of its own, derived the same way.
    expect(fingerprints['cli/config']).toBe(
      'sha256:fd58e236b50daea8bc5799cfdff4228e9a6d3ef9a54529b14fa09ec45b47a9ed',
    )
    expect(new Set(Object.values(fingerprints)).size).toBe(7)
  })
})

describe('journeyEntryLabel', () => {
  it('labels a command entry as its argv path and an operation entry as METHOD path', () => {
    expect(journeyEntryLabel({ command: ['tasks', 'add'] })).toBe('tasks add')
    expect(journeyEntryLabel({ method: 'get', path: '/todos/{id}' })).toBe('GET /todos/{id}')
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
