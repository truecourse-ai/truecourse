/**
 * `truecourse spec docs <sub>` — relevance-filter overrides (corpus path).
 *
 *   skipped                               list docs the LLM filter dropped
 *   include     <path>                    force-include a skipped doc + re-scan
 *   uninclude   <path>                    remove a force-include override + re-scan
 *
 * Force-includes are stored in decisions.json#manualIncludes and bypass the
 * relevance filter on the next curate.
 */

import * as p from '@clack/prompts';
import { readCorpusDecisions } from '@truecourse/spec-consolidator';
import {
  addManualInclude,
  removeManualInclude,
  curateInProcess,
} from '@truecourse/core/commands/spec-in-process';

export interface RunSpecDocsOptions {
  cwd?: string;
}

const repoRoot = (opts: RunSpecDocsOptions): string => opts.cwd ?? process.cwd();

export async function runSpecDocsSkipped(opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  // The corpus path doesn't persist the skipped list, so recompute it — the
  // relevance verdicts are cached, so this is cheap, and skipCorpusWrite keeps
  // it side-effect-free (corpus.json is not rewritten).
  const { curate } = await curateInProcess(root, { skipCorpusWrite: true });
  const skipped = curate.skippedDocs ?? [];
  const manualIncludes = readCorpusDecisions(root).manualIncludes ?? [];

  p.intro('Skipped docs');
  if (skipped.length === 0) p.log.step('(none)');
  for (const s of skipped) {
    p.log.message(`  ${s.path}`);
    p.log.message(`    ${s.reason}`);
  }
  if (manualIncludes.length > 0) {
    p.log.message('');
    p.log.step(`Manual includes (${manualIncludes.length})`);
    for (const inc of manualIncludes) p.log.message(`  ${inc}`);
  }
  p.outro('force-include with `truecourse spec docs include <path>`.');
}

export async function runSpecDocsInclude(docPath: string, opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  if (!docPath) return fail('Missing doc path');
  await addManualInclude(root, docPath);
  await reScan(root);
  p.outro(`Force-include ${docPath} — re-scanned. Review \`truecourse spec conflicts list\`.`);
}

export async function runSpecDocsUninclude(docPath: string, opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  if (!docPath) return fail('Missing doc path');
  await removeManualInclude(root, docPath);
  await reScan(root);
  p.outro(`Removed force-include for ${docPath} — re-scanned.`);
}

async function reScan(root: string): Promise<void> {
  const s = p.spinner();
  s.start('Re-scanning');
  await curateInProcess(root);
  s.stop('Re-scanned');
}

function fail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}
