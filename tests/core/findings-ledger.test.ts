/**
 * THE FINDINGS LEDGER (01 step 2d) — the generic append behind every
 * committable `*.findings.md` a session-pool command keeps: append-only, one
 * `## <runId> (<iso>)` section per run, deduped within the run only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendFindingsLedger } from '../../packages/core/src/services/agent/findings-ledger'

let repo: string
let ledgerPath: string

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-findings-ledger-'))
  ledgerPath = path.join(repo, 'guard', 'interfaces.findings.md')
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

const append = (
  runId: string,
  findings: readonly { workItem: string; lines: readonly string[] }[],
  preamble?: string,
) =>
  appendFindingsLedger({
    repoRoot: repo,
    ledgerPath,
    runId,
    findings,
    now: () => '2026-08-18T09:00:00.000Z',
    ...(preamble !== undefined ? { preamble } : {}),
  })

const read = (): string => fs.readFileSync(ledgerPath, 'utf-8')

describe('appendFindingsLedger', () => {
  it('writes nothing at all when the run found nothing', () => {
    expect(append('run-1', [])).toBeUndefined()
    expect(append('run-1', [{ workItem: 'web/home', lines: [] }])).toBeUndefined()
    // An empty section says the same as no section and costs a diff.
    expect(fs.existsSync(ledgerPath)).toBe(false)
  })

  it('writes the preamble once and appends a section per run', () => {
    const first = append('run-1', [{ workItem: 'web/home', lines: ['the docs name a Save button the page has not got'] }], '# Findings\n\nwhat the sessions read.\n\n')
    expect(first).toEqual({ path: ledgerPath, appended: 1 })
    expect(read()).toBe(
      `# Findings

what the sessions read.

## run-1 (2026-08-18T09:00:00.000Z)

- \`web/home\` — the docs name a Save button the page has not got
`,
    )

    const second = append('run-2', [{ workItem: 'web/settings', lines: ['the route is documented as /prefs'] }], '# Findings\n\nwhat the sessions read.\n\n')
    expect(second).toEqual({ path: ledgerPath, appended: 1 })
    // Append-only: run-1 survives verbatim, the preamble is not repeated.
    const text = read()
    expect(text.match(/^# Findings$/gm)).toHaveLength(1)
    expect(text.indexOf('## run-1')).toBeLessThan(text.indexOf('## run-2'))
    expect(text.endsWith('- `web/settings` — the route is documented as /prefs\n')).toBe(true)
  })

  it('dedupes by line within the run, keeping the first work item to report it', () => {
    const result = append('run-1', [
      { workItem: 'web/home', lines: ['The header link points at /docs, the code routes to /help'] },
      { workItem: 'web/settings', lines: ['  the header link points at /docs, the code routes to /help  '] },
      { workItem: 'web/billing', lines: [''] },
    ])
    expect(result).toEqual({ path: ledgerPath, appended: 1 })
    // Two work items reporting one sentence are ONE bug; case and surrounding
    // whitespace are not a second one.
    expect(read()).toContain(
      '- `web/home` — The header link points at /docs, the code routes to /help',
    )
    expect(read()).not.toContain('web/settings')
    expect(read()).not.toContain('web/billing')
  })

  it('keeps every distinct line of one work item as its own bullet', () => {
    const result = append('run-1', [
      { workItem: 'web/home', lines: ['first disagreement', 'second disagreement', 'third disagreement'] },
    ])
    expect(result).toEqual({ path: ledgerPath, appended: 3 })
    expect(read().split('\n').filter((line) => line.startsWith('- '))).toEqual([
      '- `web/home` — first disagreement',
      '- `web/home` — second disagreement',
      '- `web/home` — third disagreement',
    ])
  })

  it('creates the ledger directory when it does not exist yet', () => {
    expect(fs.existsSync(path.dirname(ledgerPath))).toBe(false)
    expect(append('run-1', [{ workItem: 'w', lines: ['a finding'] }])).toEqual({
      path: ledgerPath,
      appended: 1,
    })
    expect(read()).toBe('## run-1 (2026-08-18T09:00:00.000Z)\n\n- `w` — a finding\n')
  })
})
