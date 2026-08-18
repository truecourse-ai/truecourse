/**
 * THE FINDINGS LEDGER — `guard/interfaces.findings.md`, the doc-bug feed the
 * authoring sessions fill.
 *
 * A session reads a screen's own source against everything the repository says
 * about it — its docs, its comments, the derivation it was briefed with — and
 * some of the time the two disagree. `reference/AUTHORING.md` fixes what happens
 * then: the discrepancy is a DIAGNOSTIC, code wins for the catalog, and the
 * disagreement itself is preserved VERBATIM rather than resolved silently. The
 * interface schema has no home for one on purpose (a diagnostic is run reporting,
 * not interface data), so it lands here.
 *
 * Three properties the format is chosen for:
 *
 * - **Append-only, markdown, one section per run.** A finding is a claim about
 *   the repository at a moment; the next run's session may or may not see the
 *   same thing, and a ledger that overwrote itself would answer "is this still
 *   true" by deleting the question. History is the point.
 * - **Committed.** What it holds is a bug in the repository, not a record of a
 *   run — a teammate who never runs authoring still has to read it. It is not in
 *   `GITIGNORE_CONTENTS` for that reason, and nothing there catches it.
 * - **Deduped within the run only.** Two places that read the same doc report the
 *   same doc bug, and one bullet is the honest count of it; across runs the
 *   repetition is the signal that nobody has fixed it yet.
 */

import fs from 'node:fs'
import path from 'node:path'
import { guardInterfaceFindingsPath } from '@truecourse/guard-runner'

/** One discrepancy, as the session that found it stated it. */
export interface AuthorFinding {
  /** The place whose session found it. */
  placeId: string
  /** The discrepancy itself — verbatim, never summarised. */
  note: string
}

export interface AppendFindingsInput {
  repoRoot: string
  /** The authoring run — the header every bullet of this batch sits under. */
  runId: string
  findings: readonly AuthorFinding[]
  now?: () => string
}

/**
 * Append one run's findings under a `## <runId>` header. Returns nothing when
 * the run found none: an empty section says the same as no section and costs a
 * diff on a committed file.
 *
 * The write is an APPEND rather than the store's usual write-tmp-and-rename,
 * because that is what this file is — the same choice the session transcripts
 * make. A rename would rewrite the whole ledger on every run, and two runs in
 * different worktrees would then each drop the other's history.
 */
export function appendInterfaceFindings(
  input: AppendFindingsInput,
): { path: string; appended: number } | undefined {
  const deduped = dedupe(input.findings)
  if (deduped.length === 0) return undefined

  const now = input.now ?? (() => new Date().toISOString())
  const target = guardInterfaceFindingsPath(input.repoRoot)
  const preamble = fs.existsSync(target) ? '' : PREAMBLE
  const section = [
    `## ${input.runId} (${now()})`,
    ``,
    ...deduped.map((finding) => `- \`${finding.placeId}\` — ${finding.note}`),
    ``,
  ].join('\n')

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.appendFileSync(target, preamble + section, 'utf-8')
  return { path: target, appended: deduped.length }
}

/**
 * One bullet per distinct finding, first place to report it keeping the line.
 * The identity is the NOTE: the same sentence from two places is one doc bug,
 * and listing it twice would make the ledger read like two.
 */
function dedupe(findings: readonly AuthorFinding[]): AuthorFinding[] {
  const seen = new Set<string>()
  const kept: AuthorFinding[] = []
  for (const finding of findings) {
    const key = finding.note.trim().toLowerCase()
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    kept.push(finding)
  }
  return kept
}

/** Written once, when the file is created: what a reader is looking at. */
const PREAMBLE = `# Interface authoring — findings

What the authoring sessions read in the source that contradicts what this
repository says elsewhere: a doc describing a control the source does not have, a
derivation that disagrees with the module it names. Code won for the catalog;
these are the disagreements themselves, kept verbatim, one section per run.

Nothing here is resolved automatically. A finding leaves this file when somebody
fixes the doc or the code and deletes the line.

`
