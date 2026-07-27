import { describe, it, expect } from 'vitest'
import {
  JourneySchema,
  JourneyStepSchema,
  JourneyStepKindSchema,
  JourneysFileSchema,
  journeyFingerprint,
  guardDriverIds,
  type Journey,
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
      journeys: [journey([INVOKE]), journey([REQUEST], { id: 'api/create-task', type: 'api', entry: { command: ['tasks'] } })],
    }
    expect(JourneysFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file)
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
