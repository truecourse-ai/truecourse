#!/usr/bin/env node
/**
 * covergate — the command line surface: argument parsing, dispatch and the
 * three exit codes (0 ok, 1 gate failed, 2 usage or input error).
 */
import process from 'node:process'
import { CovergateError, runCheck, runInit } from './report.js'
import { runBadge } from './badge.js'

export const VERSION = '1.4.0'

const USAGE = `covergate ${VERSION}
Usage: covergate <command> [summary] [options]

Commands:
  check [summary]   Compare coverage against the minimum; exit 1 when it is below
  badge [summary]   Print a shields.io coverage badge as Markdown
  init              Write a default .covergaterc.json

Options:
  --version         Print the version
  --help            Print this help

Exit codes: 0 success, 1 coverage below the minimum, 2 usage or input error.
`

const CHECK_USAGE = `Usage: covergate check [summary] [options]

Compare one metric of an Istanbul json-summary report against the minimum.

Options:
  --min <pct>       Minimum acceptable coverage (default 80)
  --metric <name>   lines, statements, functions or branches (default lines)
`

const BADGE_USAGE = `Usage: covergate badge [summary] [options]

Print a shields.io coverage badge for one metric as Markdown.

Options:
  --metric <name>   lines, statements, functions or branches (default lines)
  --out <path>      Write the badge to this file instead of stdout
`

const INIT_USAGE = `Usage: covergate init

Write a default .covergaterc.json in the working directory. It takes no
arguments and never overwrites a file that is already there.
`

const COMMANDS = {
  check: { flags: ['min', 'metric'], maxPositionals: 1, usage: CHECK_USAGE, run: runCheck },
  badge: { flags: ['metric', 'out'], maxPositionals: 1, usage: BADGE_USAGE, run: runBadge },
  init: { flags: [], maxPositionals: 0, usage: INIT_USAGE, run: runInit },
}

/** `--name value` and `--name=value` both; `--help` / `--version` are boolean. */
function parseArgs(argv) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (name === 'help' || name === 'version') {
      flags[name] = true
      continue
    }
    let value = eq === -1 ? undefined : arg.slice(eq + 1)
    if (value === undefined) {
      value = argv[i + 1]
      if (value === undefined) throw new CovergateError(`covergate: --${name} needs a value`)
      i += 1
    }
    flags[name] = value
  }
  return { flags, positionals }
}

function main(argv, stdout, stderr) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    if (!(error instanceof CovergateError)) throw error
    stderr(`${error.message}\n`)
    return 2
  }
  const { flags, positionals } = parsed

  if (flags.version === true) {
    stdout(`covergate ${VERSION}\n`)
    return 0
  }
  if (positionals.length === 0) {
    stdout(USAGE)
    return 0
  }

  const [name, ...rest] = positionals
  const command = COMMANDS[name]
  if (!command) {
    stderr(`covergate: unknown command "${name}"\n`)
    return 2
  }
  if (flags.help === true) {
    stdout(command.usage)
    return 0
  }
  if (rest.length > command.maxPositionals) {
    stderr(
      command.maxPositionals === 0
        ? `covergate: ${name} takes no arguments\n`
        : `covergate: ${name} takes at most one summary path\n`,
    )
    return 2
  }
  for (const key of Object.keys(flags)) {
    if (key === 'help' || key === 'version') continue
    if (!command.flags.includes(key)) {
      stderr(`covergate: ${name} does not accept --${key}\n`)
      return 2
    }
  }

  const settings = { ...flags }
  if (settings.min !== undefined) {
    const min = Number(settings.min)
    if (!Number.isFinite(min)) {
      stderr('covergate: the minimum must be a number between 0 and 100\n')
      return 2
    }
    settings.min = min
  }

  try {
    return command.run({
      cwd: process.cwd(),
      flags: settings,
      positional: rest[0],
      stdout,
      stderr,
    })
  } catch (error) {
    if (!(error instanceof CovergateError)) throw error
    stderr(`${error.message}\n`)
    return 2
  }
}

process.exitCode = main(
  process.argv.slice(2),
  (text) => process.stdout.write(text),
  (text) => process.stderr.write(text),
)
