/**
 * THE FINDINGS LEDGER — the generic append behind every committable
 * `*.findings.md` a session-pool command keeps.
 *
 * Sessions read the repository against what the repository says about itself,
 * and some of the time the two disagree. The command decides WHICH file holds
 * its discrepancies (interface authoring: `guard/interfaces.findings.md`;
 * later phases pick their own ledger path when their outcomes carry
 * `findings`); the format and the append discipline are shared and live here.
 *
 * Three properties every ledger written through this keeps (they are why the
 * interface-authoring ledger chose them — see that thin caller for the fuller
 * story):
 *
 * - **Append-only, markdown, one `## <runId> (<iso>)` section per run.** A
 *   finding is a claim about the repository at a moment; overwriting would
 *   answer "is this still true" by deleting the question. Plain append, not
 *   the store's write-tmp-and-rename — a rename would rewrite the whole file
 *   and two worktrees would each drop the other's history.
 * - **Committed.** What a ledger holds is a report about the REPOSITORY, not a
 *   record of a run — keep any new ledger path out of `GITIGNORE_CONTENTS`.
 * - **Deduped within the run only.** The identity of a finding is its LINE:
 *   two work items reporting the same sentence are one bug, and one bullet is
 *   the honest count of it; across runs the repetition is the signal that
 *   nobody has fixed it yet.
 */

import fs from 'node:fs'
import path from 'node:path'

export interface FindingsLedgerInput {
  /** The repo the ledger belongs to — the scope, mirroring the KV-cache seam.
   *  The file-backed append does not consult it (`ledgerPath` is already
   *  absolute); declared so swapping in a store-backed impl later changes no
   *  caller. */
  repoRoot: string
  /** Absolute path of the ledger file, e.g.
   *  `guardInterfaceFindingsPath(repoRoot)`. */
  ledgerPath: string
  /** The run — the header every bullet of this batch sits under. */
  runId: string
  now?: () => string
  /** Per work item, the discrepancy lines VERBATIM — never summarised. */
  findings: readonly { workItem: string; lines: readonly string[] }[]
  /** Written once, when the file is created: what a reader is looking at. */
  preamble?: string
}

/**
 * Append one run's findings under a `## <runId> (<iso>)` header, one bullet
 * per distinct line (`- \`<workItem>\` — <line>`, first work item to report a
 * line keeps it). Returns `undefined` without touching the file when the run
 * found nothing: an empty section says the same as no section and costs a diff
 * on a committed file.
 */
export function appendFindingsLedger(
  input: FindingsLedgerInput,
): { path: string; appended: number } | undefined {
  const deduped = dedupe(input.findings)
  if (deduped.length === 0) return undefined

  const now = input.now ?? (() => new Date().toISOString())
  const target = input.ledgerPath
  const preamble = fs.existsSync(target) ? '' : (input.preamble ?? '')
  const section = [
    `## ${input.runId} (${now()})`,
    ``,
    ...deduped.map((finding) => `- \`${finding.workItem}\` — ${finding.line}`),
    ``,
  ].join('\n')

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.appendFileSync(target, preamble + section, 'utf-8')
  return { path: target, appended: deduped.length }
}

/**
 * One bullet per distinct line within the batch. Identity is the trimmed,
 * lowercased line; empty lines are dropped. Work-list order is preserved, and
 * the FIRST work item to report a line is the one named on its bullet.
 */
function dedupe(
  findings: readonly { workItem: string; lines: readonly string[] }[],
): { workItem: string; line: string }[] {
  const seen = new Set<string>()
  const kept: { workItem: string; line: string }[] = []
  for (const finding of findings) {
    for (const line of finding.lines) {
      const key = line.trim().toLowerCase()
      if (key.length === 0 || seen.has(key)) continue
      seen.add(key)
      kept.push({ workItem: finding.workItem, line })
    }
  }
  return kept
}
