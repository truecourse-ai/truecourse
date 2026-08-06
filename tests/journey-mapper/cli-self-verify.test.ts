/**
 * The journey-completeness gate over TrueCourse's OWN CLI: the static derivation
 * (analyzer → journey-mapper) is diffed against the commander registry
 * introspected at runtime. A real, rich commander program with every
 * registration idiom the codebase uses (nested variables, option factories,
 * spread choices, --no-X negations), so an extractor regression or a new idiom
 * breaks this test the day it appears.
 *
 * Out of scope BY CONSTRUCTION (journeys do not model them): positional
 * arguments, command aliases, commander's auto `help` subcommand, hidden
 * options, and each SUBCOMMAND's generated `-h/--help` (journeys carry the
 * generated help flag on the root only). Descriptions are metadata, not facts,
 * and are not diffed.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'
import { deriveCliJourneysFromTree } from '../../packages/journey-mapper/src/cli-tree'
import type { Journey, JourneyCliOption } from '../../packages/shared/src/index'

// The env guard must be set BEFORE the CLI module evaluates (it calls
// `program.parse()` at top level otherwise); hence the dynamic import below.
process.env.TRUECOURSE_CLI_INTROSPECT = '1'

const CLI_INDEX = path.resolve(__dirname, '../../tools/cli/src/index.ts')

/** The commander surface this gate reads: structural, so the test does not
 *  depend on commander's own type exports. */
interface CommanderOption {
  flags: string
  long?: string
  short?: string
  /** The VALUE is required (`<v>`), not the option itself. */
  required: boolean
  /** The value is optional (`[v]`). */
  optional: boolean
  /** Declared via `requiredOption`: the option itself must be passed. */
  mandatory: boolean
  hidden?: boolean
  argChoices?: string[]
}

interface CommanderCommand {
  name(): string
  commands: CommanderCommand[]
  options: CommanderOption[]
  _helpOption?: CommanderOption
  _hidden?: boolean
}

/** The comparable option facts, both sides normalized onto this shape. */
interface OptionFacts {
  flag: string
  required: boolean
  takesValue: boolean
  valueHint?: string
  choices?: string[]
}

const VALUE_PLACEHOLDER = /[<[]([^\]>]+)[>\]]/

function factsOfRuntimeOption(option: CommanderOption): OptionFacts {
  const hint = VALUE_PLACEHOLDER.exec(option.flags)?.[1]?.replace(/\.{3}$/, '').trim()
  const takesValue = option.required || option.optional
  return {
    flag: option.long ?? option.short ?? option.flags,
    required: option.mandatory === true,
    takesValue,
    ...(takesValue && hint ? { valueHint: hint } : {}),
    ...(option.argChoices?.length ? { choices: [...option.argChoices] } : {}),
  }
}

function factsOfJourneyOption(option: JourneyCliOption): OptionFacts {
  return {
    flag: option.flag,
    required: option.required === true,
    takesValue: option.takesValue === true,
    ...(option.valueHint ? { valueHint: option.valueHint } : {}),
    ...(option.choices?.length ? { choices: [...option.choices] } : {}),
  }
}

/** Walk the registry: one row per command, keyed by argv path ('' = the root). */
function collectRuntime(program: CommanderCommand): Map<string, OptionFacts[]> {
  const rows = new Map<string, OptionFacts[]>()
  const walk = (cmd: CommanderCommand, prefix: string[]): void => {
    const own = cmd.options.filter((o) => !o.hidden).map(factsOfRuntimeOption)
    if (prefix.length === 0) {
      // The generated help option is registry state, not a member of `.options`.
      // Journeys model it on the root; commander creates the default lazily, so
      // a not-yet-materialized `_helpOption` reads as the default `-h, --help`.
      const help = cmd._helpOption
        ? factsOfRuntimeOption(cmd._helpOption)
        : { flag: '--help', required: false, takesValue: false }
      own.push(help)
    }
    rows.set(prefix.join(' '), sortFacts(own))
    for (const sub of cmd.commands) {
      if (sub._hidden) continue
      // Commander's auto `help` subcommand: excluded by construction.
      if (sub.name() === 'help') continue
      walk(sub, [...prefix, sub.name()])
    }
  }
  walk(program, [])
  return rows
}

/** One row per journey, keyed the same way; program-scope entries are the
 *  root's flags riding subcommand grammars and are compared separately. */
function collectStatic(journeys: Journey[], programName: string): Map<string, OptionFacts[]> {
  const rows = new Map<string, OptionFacts[]>()
  for (const journey of journeys) {
    if (!('command' in journey.entry)) continue
    const step = journey.steps[0]
    if (step.kind !== 'invoke') continue
    const key =
      journey.entry.command.length === 1 && journey.entry.command[0] === programName
        ? ''
        : journey.entry.command.join(' ')
    const own = (step.options ?? []).filter((o) => o.scope !== 'program')
    rows.set(key, sortFacts(own.map(factsOfJourneyOption)))
  }
  return rows
}

function sortFacts(facts: OptionFacts[]): OptionFacts[] {
  return [...facts].sort((a, b) => a.flag.localeCompare(b.flag))
}

// Top-level await: the registry import happens once, after the env guard above.
const { program } = (await import('../../tools/cli/src/index')) as unknown as {
  program: CommanderCommand
}
const source = fs.readFileSync(CLI_INDEX, 'utf-8')
const journeys = deriveCliJourneysFromTree(
  [analyzeFileContent(CLI_INDEX, source, 'typescript')],
  { programName: 'truecourse' },
)
const runtime = collectRuntime(program)
const derived = collectStatic(journeys, 'truecourse')

describe('self-verification: TrueCourse CLI static derivation ≡ commander registry', () => {
  it('the command path sets are identical', () => {
    expect([...derived.keys()].sort()).toEqual([...runtime.keys()].sort())
    // The comparison must never go vacuously green: this is the real program,
    // with its full tree (root + every registered command, nesting to depth 3).
    expect(runtime.size).toBeGreaterThan(50)
    expect(runtime.has('config llm setup')).toBe(true)
    expect(runtime.has('guard flows dismiss')).toBe(true)
  })

  it('the factory-built --llm-transport option resolves with its choices on both sides', () => {
    // The measured field gap: `.addOption(llmTransportOption())` silently
    // dropped the flag for weeks. Pin the exact fact on both sides.
    const fact = {
      flag: '--llm-transport',
      required: false,
      takesValue: true,
      valueHint: 'mode',
      choices: ['cli', 'agent', 'api'],
    }
    for (const key of ['analyze', 'spec scan', 'guard generate', 'guard setup']) {
      expect(runtime.get(key)?.find((o) => o.flag === '--llm-transport'), `runtime ${key}`).toEqual(fact)
      expect(derived.get(key)?.find((o) => o.flag === '--llm-transport'), `derived ${key}`).toEqual(fact)
    }
  })

  it('every command carries identical option facts', () => {
    // The ONE deliberate exclusion: `config llm setup --provider` spreads an
    // IMPORTED const (`[...LLM_PROVIDER_KINDS]` from @truecourse/shared) into
    // its choices. Per-file static analysis cannot see a value defined in
    // another package, so the choices fact is unmodelable here; the tree∪probe
    // union carries it at mapping time (the probe reads it out of --help), with
    // a `tree-missing-flag` diagnostic keeping the gap visible.
    const provider = runtime.get('config llm setup')?.find((o) => o.flag === '--provider')
    expect(provider?.choices).toEqual(['anthropic', 'openai', 'bedrock', 'copilot'])
    delete provider?.choices

    for (const [key, expected] of runtime) {
      expect(derived.get(key), `option facts for ${key === '' ? 'the root' : `\`${key}\``}`).toEqual(
        expected,
      )
    }
  })

  it('the root journey exists, rooted at the program name, with --version and --help', () => {
    const root = journeys.find((j) => j.id === 'cli/root')
    expect(root).toMatchObject({ entry: { command: ['truecourse'] } })
    const flags = root?.steps[0].kind === 'invoke' ? root.steps[0].flags : []
    expect(flags).toContain('--version')
    expect(flags).toContain('--help')
  })

  it('program-scope entries mirror the program-level declarations exactly', () => {
    // TrueCourse declares no program-level `.option()` today, so no subcommand
    // may carry one; the moment one is declared, the cli-tree derivation must
    // propagate it (covered by unit tests) and this asserts the mirror stays
    // exact against the runtime registry.
    const runtimeProgramDeclared = program.options
      .filter((o) => !o.hidden && (o.long ?? o.short) !== '--version')
      .map(factsOfRuntimeOption)
    for (const journey of journeys) {
      if (journey.id === 'cli/root') continue
      const step = journey.steps[0]
      if (step.kind !== 'invoke') continue
      const scoped = (step.options ?? []).filter((o) => o.scope === 'program')
      expect(sortFacts(scoped.map(factsOfJourneyOption))).toEqual(sortFacts(runtimeProgramDeclared))
    }
  })
})
