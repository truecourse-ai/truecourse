/**
 * THE FINDINGS REPORT (plan 05 step 24) — `guard/findings.md`, the pure render
 * of the board's `bug` / `drift` adjudications. Written on demand by
 * `truecourse guard adjudicate --report`, rendered by the dashboard, COMMITTED
 * (deliberately not in `GITIGNORE_CONTENTS`). GitHub stays untouched.
 *
 * Each finding is one `## F<n>` section: headline verdict, class, the verbatim
 * doc quote resolved from the scenario's `binds` (with the drift said out loud
 * when the section's live text no longer carries the bound fingerprint),
 * mechanism (+ file:line for a bug), the observed value, and the control ref.
 *
 * NUMBERING IS STABLE by first-seen order and persisted in the report file
 * itself: a `<!-- numbering: {…} -->` registry at the top maps finding
 * identity (the scenario id) → its `F<n>`, and the registry only grows — a
 * finding that leaves the board keeps its number reserved, so `F7` in an old
 * conversation never silently becomes a different bug.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  extractSectionTexts,
  fingerprintText,
  guardFindingsReportPath,
  nodeRefContext,
} from '@truecourse/guard-runner';
import {
  guardResultRunId,
  type GuardLatest,
  type GuardScenarioResult,
} from '@truecourse/shared';

/** Cap on the verbatim doc quote one finding inlines. */
const QUOTE_CHARS = 700;

const NUMBERING_RE = /^<!-- numbering: (\{.*\}) -->$/m;

const PREAMBLE = `# Guard findings

The open \`bug\` / \`drift\` verdicts of \`truecourse guard adjudicate\`, rendered
from the guard board. Regenerated whole by \`truecourse guard adjudicate
--report\`; finding numbers are stable (first-seen order) and never reused.
`;

/** Parse the persisted numbering registry out of a prior report, `{}` when none. */
export function parseFindingNumbering(prior: string | null): Record<string, number> {
  if (!prior) return {};
  const match = NUMBERING_RE.exec(prior);
  if (!match) return {};
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(parsed)) {
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[id] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/** A board row that feeds the report: adjudicated `bug` or `drift`. */
function isReportFinding(row: GuardScenarioResult): boolean {
  return row.adjudication !== undefined && (row.adjudication.class === 'bug' || row.adjudication.class === 'drift');
}

/**
 * Resolve the verbatim quote for a finding's primary bind — the section's live
 * full text, with an honest annotation when it has drifted past the bound
 * fingerprint (or is gone).
 */
function resolveQuote(
  repoRoot: string,
  bind: { doc: string; section: string; fingerprint: string },
): { quote: string; note?: string } {
  const abs = path.resolve(repoRoot, bind.doc);
  let content: string;
  try {
    content = fs.readFileSync(abs, 'utf-8');
  } catch {
    return { quote: '', note: 'the bound document is not on disk' };
  }
  // `extractSectionTexts` returns the sections keyed by anchor.
  const section = extractSectionTexts(bind.doc, content, nodeRefContext(repoRoot, abs)).get(bind.section);
  if (!section) return { quote: '', note: 'the bound section no longer exists in the document' };
  const quote =
    section.fullText.length > QUOTE_CHARS
      ? `${section.fullText.slice(0, QUOTE_CHARS)}…`
      : section.fullText;
  const drifted = fingerprintText(section.fullText) !== bind.fingerprint;
  return {
    quote,
    ...(drifted ? { note: 'the section text has been edited since the scenario bound it' } : {}),
  };
}

export interface RenderedFindingsReport {
  content: string;
  /** Findings in the rendered report. */
  findings: number;
}

/**
 * Render the report from a board + the prior report text (numbering source).
 * Returns `null` when there is nothing to write: no open bug/drift finding AND
 * no prior report to honestly empty out.
 */
export function renderGuardFindingsReport(input: {
  repoRoot: string;
  latest: GuardLatest | null;
  prior: string | null;
  now?: () => string;
}): RenderedFindingsReport | null {
  const rows = (input.latest?.scenarios ?? []).filter(isReportFinding);
  const numbering = parseFindingNumbering(input.prior);
  if (rows.length === 0 && input.prior === null) return null;

  let next = Math.max(0, ...Object.values(numbering)) + 1;
  // First-seen order: rows already numbered keep their number; new ones are
  // assigned in board order (sorted by scenario id — the board's own order).
  for (const row of rows) {
    if (numbering[row.id] === undefined) numbering[row.id] = next++;
  }
  const ordered = [...rows].sort((a, b) => numbering[a.id] - numbering[b.id]);

  const now = input.now ?? (() => new Date().toISOString());
  const lines: string[] = [
    PREAMBLE.trimEnd(),
    '',
    `<!-- numbering: ${JSON.stringify(numbering)} -->`,
    '',
    `_Rendered ${now()} — ${ordered.length} open finding${ordered.length === 1 ? '' : 's'}._`,
    '',
  ];
  if (ordered.length === 0) {
    lines.push('No open `bug` / `drift` findings on the current board.');
  }
  for (const row of ordered) {
    const a = row.adjudication!;
    const envelope = input.latest!.run;
    lines.push(`## F${numbering[row.id]} — ${row.title}`);
    lines.push(`<!-- finding: ${row.id} -->`);
    lines.push('');
    lines.push(`- **class**: ${a.class} (${a.confidence} confidence)`);
    lines.push(
      `- **scenario**: \`${row.id}\`${row.flowId ? ` · flow \`${row.flowId}\`` : ''} · run ${guardResultRunId(row, envelope)}`,
    );
    lines.push(`- **binds**: ${row.binds.doc} #${row.binds.section}`);
    lines.push(`- **mechanism**: ${a.mechanism}${a.code ? ` (\`${a.code.file}:${a.code.line}\`)` : ''}`);
    if (row.failure) {
      lines.push(`- **observed** (step ${row.failure.step}): expected \`${row.failure.expected}\` — actual \`${row.failure.actual}\``);
    }
    if (a.control) {
      lines.push(`- **control**: ${a.control.conclusion} (${a.control.transcriptRef}) — ${a.control.reasoning}`);
    }
    if (a.evidence.length > 0) {
      lines.push('- **evidence**:');
      for (const quote of a.evidence) lines.push(`  - ${quote}`);
    }
    const { quote, note } = resolveQuote(input.repoRoot, row.binds);
    if (note) lines.push(`- **doc quote**: _${note}_`);
    if (quote) {
      lines.push('');
      lines.push(...quote.trimEnd().split('\n').map((l) => `> ${l}`));
    }
    lines.push('');
  }
  return { content: lines.join('\n').trimEnd() + '\n', findings: ordered.length };
}

/**
 * Render + write `guard/findings.md` (write-to-tmp + rename, the store's
 * atomicity discipline on a text file). Returns what landed, or `null` when
 * there was nothing to write.
 */
export function writeGuardFindingsReport(
  repoRoot: string,
  latest: GuardLatest | null,
  now?: () => string,
): { path: string; findings: number } | null {
  const target = guardFindingsReportPath(repoRoot);
  const prior = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : null;
  const rendered = renderGuardFindingsReport({ repoRoot, latest, prior, ...(now ? { now } : {}) });
  if (!rendered) return null;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, rendered.content, 'utf-8');
  fs.renameSync(tmp, target);
  return { path: target, findings: rendered.findings };
}
