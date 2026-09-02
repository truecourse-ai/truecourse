/**
 * THE INTERFACE-AUTHORING FINDINGS — `guard/interfaces.findings.md`, the
 * doc-bug feed the authoring sessions fill.
 *
 * A session reads a screen's own source against everything the repository says
 * about it — its docs, its comments, the derivation it was briefed with — and
 * some of the time the two disagree. `reference/AUTHORING.md` fixes what happens
 * then: the discrepancy is a DIAGNOSTIC, code wins for the catalog, and the
 * disagreement itself is preserved VERBATIM rather than resolved silently. The
 * interface schema has no home for one on purpose (a diagnostic is run reporting,
 * not interface data), so it lands here.
 *
 * The append discipline itself — append-only markdown, one `## <runId>` section
 * per run, committed, deduped within the run only — is the generic
 * {@link appendFindingsLedger}; this module only fixes WHICH file
 * (`guardInterfaceFindingsPath`) and what its preamble says.
 */

import { guardInterfaceFindingsPath } from '@truecourse/guard-runner'
import { appendFindingsLedger } from '../agent/findings-ledger.js'

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
 */
export function appendInterfaceFindings(
  input: AppendFindingsInput,
): { path: string; appended: number } | undefined {
  return appendFindingsLedger({
    repoRoot: input.repoRoot,
    ledgerPath: guardInterfaceFindingsPath(input.repoRoot),
    runId: input.runId,
    ...(input.now ? { now: input.now } : {}),
    findings: input.findings.map((finding) => ({
      workItem: finding.placeId,
      lines: [finding.note],
    })),
    preamble: PREAMBLE,
  })
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
