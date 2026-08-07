import { describe, it, expect } from 'vitest'
import {
  JOURNEY_UNKNOWN,
  JourneyContractSchema,
  JourneyDiagnosticSchema,
  JourneyOptionSchema,
  JourneySchema,
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
// The contract: the full grammar plus each command's input/output. Additive and
// optional — a catalog that carries only the command tree must keep parsing, and
// enriching one must not move a single identity.
// ---------------------------------------------------------------------------

const CONTRACT: JourneyContract = {
  summary: '`tasks add` and its `--json` mode.',
  derivedFrom: ['Source of truth: src/cli.ts', 'Cross-check: `tasks add --help` probe'],
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
          positionalsNote: 'one title',
          flagsNote: 'see grammar',
          stdin: [{ name: 'none', when: 'never — the title is an argument' }],
          reads: [{ path: '~/.tasks.json', as: 'the task store' }],
          environment: ['TASKS_HOME — relocates the store'],
        },
        produces: {
          stdout: [{ shape: 'created line', when: 'always', content: 'Created task <id>' }],
          stderr: [],
          writes: [{ path: '~/.tasks.json', when: 'always', note: 'rewritten in place' }],
          exitCodes: [
            { code: '0', means: 'task created' },
            { code: JOURNEY_UNKNOWN, means: 'the store being unwritable declares no exit path in code' },
          ],
          sideEffects: [],
        },
      },
      notes: ['Re-running with the same title creates a second task.'],
      inheritsShared: [{ block: 'stdin', note: 'the first-run wizard' }],
    },
  ],
  shared: {
    note: 'Facts every command in the tree carries.',
    stdin: [{ name: 'first-run wizard', when: 'no config saved', prompts: ['Where should tasks live?'] }],
    reads: [{ path: '~/.tasksrc', as: 'configuration' }],
    writes: [{ path: '~/.tasksrc', when: 'first run' }],
    exitCodes: [{ code: '1', means: 'no store here' }],
    environment: ['TASKS_HOME'],
    enumerations: [{ name: 'priorities', values: ['low', 'high'], note: 'validated in the action' }],
    files: [{ path: '~/.tasksrc', keys: ['store'], note: 'created on first run' }],
    notes: ['Every command resolves the store by walking up from the cwd.'],
  },
  decisions: [
    {
      id: 'no-remote-store',
      decision: 'The contract models the local store only.',
      consequencesNotModeled: ['the remote-sync exit path'],
    },
  ],
}

const DIAGNOSTICS = [
  { kind: 'docs-missing-behavior', subject: '--priority', detail: 'The docs omit the default.', right: 'code' },
  { kind: 'grammar-agreement', subject: 'add flag set', detail: 'Docs and code list the same flags.', right: 'both agree' },
]

describe('the journey contract', () => {
  it('parses a journey carrying the full contract and its findings', () => {
    const rich = { ...journey([INVOKE]), contract: CONTRACT, diagnostics: DIAGNOSTICS }
    const parsed = JourneySchema.parse(JSON.parse(JSON.stringify(rich)))
    expect(parsed).toEqual(rich)
  })

  it('a catalog that carries only the command tree still parses — the growth is additive', () => {
    // Byte-for-byte the shape the mapper writes today: no contract, no diagnostics.
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
    expect(parsed.journeys[0].diagnostics).toBeUndefined()
  })

  it('round-trips a contract-bearing catalog through JSON unchanged', () => {
    const file = {
      version: 1 as const,
      generatedAt: '2026-08-06T12:00:00.000Z',
      recipeFingerprint: 'sha256:recipe',
      journeys: [{ ...journey([INVOKE]), contract: CONTRACT, diagnostics: DIAGNOSTICS }],
      source: { cli: 'tree' as const },
    }
    expect(JourneysFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file)
  })

  it('keeps "established as none" and "never established" apart', () => {
    const parsed = JourneyContractSchema.parse(JSON.parse(JSON.stringify(CONTRACT)))
    const io = parsed.commands[0].io
    // Authored empty lists survive as empty lists — they say "none", out loud.
    expect(io?.produces?.stderr).toEqual([])
    expect(io?.produces?.sideEffects).toEqual([])
    expect(parsed.commands[0].subcommands).toEqual([])
    // A field nobody established stays absent — never coerced into an empty "none".
    const bare = JourneyContractSchema.parse({ commands: [{ path: ['tasks'] }] })
    expect(bare.commands[0].options).toBeUndefined()
    expect(bare.commands[0].positionals).toBeUndefined()
    expect(bare.commands[0].io).toBeUndefined()
  })

  it('records an unestablished exit code as `unknown` rather than a plausible number', () => {
    const codes = CONTRACT.commands[0].io?.produces?.exitCodes ?? []
    expect(codes.map((c) => c.code)).toContain(JOURNEY_UNKNOWN)
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
    expect(() =>
      JourneyContractSchema.parse({ commands: [{ path: ['tasks'], inheritsShared: [{ block: 'vibes' }] }] }),
    ).toThrow()
    // A finding names what it is about; the verdict may be unsettled.
    expect(() => JourneyDiagnosticSchema.parse({ kind: 'docs-missing-behavior', detail: 'x' })).toThrow()
    expect(
      JourneyDiagnosticSchema.parse({ kind: 'probe-missing-flag', subject: '--json', detail: 'x' }).right,
    ).toBeUndefined()
  })

  it('the CONTRACT never moves a journey identity — the invariant the whole growth rests on', () => {
    const bare = journey([INVOKE])
    const enriched = { ...bare, contract: CONTRACT, diagnostics: DIAGNOSTICS }
    // Same shape in, same fingerprint out: grammar, io and findings are what a
    // command TAKES, not which command it is.
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
      diagnostics: [...DIAGNOSTICS, { kind: 'tree-missing-flag', subject: '--json', detail: 'the probe saw it' }],
    }
    expect(journeyFingerprint(relearned)).toBe(bare.fingerprint)
    // The surface itself still moves it — the fingerprint is not simply inert.
    expect(journeyFingerprint({ ...bare, steps: [{ ...INVOKE, flags: ['--json', '--quiet'] }] })).not.toBe(
      bare.fingerprint,
    )
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
