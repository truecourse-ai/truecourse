/**
 * The shields.io badge half. The badge is a URL, so building one needs no
 * network: covergate only prints the Markdown that references it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { metricPct, readSummary, resolveSettings } from './report.js'

/** The shields.io static-badge endpoint every generated badge points at. */
export const SHIELDS_BADGE_BASE = 'https://img.shields.io/badge'

/** The shields.io colour for a percentage. */
export function badgeColor(pct) {
  if (pct >= 90) return 'brightgreen'
  if (pct >= 80) return 'green'
  if (pct >= 60) return 'yellow'
  return 'red'
}

/** The badge image URL for a metric at a percentage. */
export function badgeUrl(metric, pct) {
  return `${SHIELDS_BADGE_BASE}/${metric}-${pct.toFixed(2)}%25-${badgeColor(pct)}`
}

/** The Markdown image the `badge` command emits. */
export function badgeMarkdown(metric, pct) {
  return `![${metric} coverage](${badgeUrl(metric, pct)})`
}

/** `covergate badge` — print the Markdown, or write it to `--out`. */
export function runBadge(ctx) {
  const { summary, metric } = resolveSettings(ctx)
  const pct = metricPct(readSummary(ctx.cwd, summary), metric, summary)
  const markdown = badgeMarkdown(metric, pct)

  const out = ctx.flags.out
  if (out === undefined) {
    ctx.stdout(`${markdown}\n`)
    return 0
  }

  const file = path.resolve(ctx.cwd, out)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${markdown}\n`)
  ctx.stdout(`covergate: wrote ${out}\n`)
  return 0
}
