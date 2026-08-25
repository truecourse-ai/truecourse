/**
 * Configuration, the coverage summary reader, and the gate itself.
 */
import fs from 'node:fs'
import path from 'node:path'
import stripJsonComments from 'strip-json-comments'

export const CONFIG_FILE = '.covergaterc.json'
export const DEFAULT_SUMMARY = 'coverage/coverage-summary.json'
export const DEFAULT_MIN = 80
export const DEFAULT_METRIC = 'lines'
export const METRICS = ['lines', 'statements', 'functions', 'branches']

const CONFIG_TEMPLATE = `{
  // Minimum acceptable coverage, in percent.
  "min": 80,
  // Which metric the gate reads: lines, statements, functions, or branches.
  "metric": "lines",
  // Where the Istanbul json-summary report is written.
  "summary": "coverage/coverage-summary.json"
}
`

/** An error whose message is already the line the CLI should print. */
export class CovergateError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CovergateError'
  }
}

/** The parsed `.covergaterc.json`, or `{}` when the repository has none. */
export function loadConfig(cwd) {
  const file = path.resolve(cwd, CONFIG_FILE)
  if (!fs.existsSync(file)) return {}
  let parsed
  try {
    parsed = JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8')))
  } catch {
    throw new CovergateError(`covergate: ${CONFIG_FILE} is not valid JSON`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CovergateError(`covergate: ${CONFIG_FILE} must contain a JSON object`)
  }
  return parsed
}

/** Command line beats config file beats built-in default, per setting. */
export function resolveSettings(ctx) {
  const config = loadConfig(ctx.cwd)

  const summary = ctx.positional ?? config.summary ?? DEFAULT_SUMMARY
  if (typeof summary !== 'string' || summary.trim() === '') {
    throw new CovergateError('covergate: the summary path must be a non-empty string')
  }

  const metric = ctx.flags.metric ?? config.metric ?? DEFAULT_METRIC
  if (typeof metric !== 'string' || !METRICS.includes(metric)) {
    throw new CovergateError(`covergate: unknown metric "${metric}" (expected one of: ${METRICS.join(', ')})`)
  }

  const min = ctx.flags.min ?? config.min ?? DEFAULT_MIN
  if (typeof min !== 'number' || !Number.isFinite(min) || min < 0 || min > 100) {
    throw new CovergateError('covergate: the minimum must be a number between 0 and 100')
  }

  return { summary, metric, min }
}

/** The parsed coverage summary at `relPath`. */
export function readSummary(cwd, relPath) {
  const file = path.resolve(cwd, relPath)
  if (!fs.existsSync(file)) {
    throw new CovergateError(`covergate: cannot read ${relPath}`)
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new CovergateError(`covergate: ${relPath} is not valid JSON`)
  }
}

/** The `total.<metric>.pct` value the report records. */
export function metricPct(summary, metric, relPath) {
  const pct = summary?.total?.[metric]?.pct
  if (typeof pct !== 'number' || !Number.isFinite(pct)) {
    throw new CovergateError(`covergate: ${relPath} has no total.${metric}.pct`)
  }
  return pct
}

/** `covergate check` — one verdict line, exit 0 on pass and 1 on failure. */
export function runCheck(ctx) {
  const { summary, metric, min } = resolveSettings(ctx)
  const pct = metricPct(readSummary(ctx.cwd, summary), metric, summary)
  const verdict = pct >= min ? 'PASS' : 'FAIL'
  ctx.stdout(`${verdict} ${metric} ${pct.toFixed(2)}% (minimum ${min.toFixed(2)}%)\n`)
  return verdict === 'PASS' ? 0 : 1
}

/** `covergate init` — write the default config, never overwrite one. */
export function runInit(ctx) {
  const file = path.resolve(ctx.cwd, CONFIG_FILE)
  if (fs.existsSync(file)) {
    throw new CovergateError(`covergate: ${CONFIG_FILE} already exists`)
  }
  fs.writeFileSync(file, CONFIG_TEMPLATE)
  ctx.stdout(`covergate: created ${CONFIG_FILE}\n`)
  return 0
}
