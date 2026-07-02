/**
 * `truecourse spec docs <sub>` — relevance-filter overrides (corpus path).
 *
 *   list                                  list the kept (corpus) docs + area tags
 *   skipped                               list docs the LLM filter dropped
 *   include     <path>                    force-include a skipped doc + re-scan
 *   uninclude   <path>                    remove a force-include override + re-scan
 *   exclude     <path>                    force-exclude a kept doc + re-scan
 *   unexclude   <path>                    remove a force-exclude override + re-scan
 *
 * Force-includes (decisions.json#manualIncludes) bypass the relevance filter;
 * force-excludes (decisions.json#manualExcludes) drop an otherwise-kept doc from
 * the corpus. Both apply on the next curate; a force-exclude wins over a
 * force-include for the same path.
 */

import * as p from '@clack/prompts';
import { readCorpusDecisions } from '@truecourse/spec-consolidator';
import {
  addManualInclude,
  removeManualInclude,
  addManualExclude,
  removeManualExclude,
  curateInProcess,
  getCorpus,
} from '@truecourse/core/commands/spec-in-process';

export interface RunSpecDocsOptions {
  cwd?: string;
}

const repoRoot = (opts: RunSpecDocsOptions): string => opts.cwd ?? process.cwd();

export async function runSpecDocsList(opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  // Read the persisted corpus (same set the dashboard's Documents list shows) —
  // no LLM, no re-curate. Reflects the last scan; run `spec scan` if docs changed.
  const corpus = await getCorpus(root);
  p.intro('Corpus docs');
  if (!corpus) {
    p.log.warn('No corpus yet — run `truecourse spec scan` first.');
    p.outro('');
    return;
  }
  const docs = corpus.docs ?? [];
  if (docs.length === 0) p.log.step('(none)');
  for (const d of docs) {
    const tags = d.areaTags?.length ? `  [${d.areaTags.join(', ')}]` : '';
    p.log.message(`  ${d.ref}${tags}`);
  }
  p.outro('Force-exclude a doc with `truecourse spec docs exclude <path>`.');
}

export async function runSpecDocsSkipped(opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  // Recompute the skipped list so it's always fresh against the current docs
  // (corpus.json persists a snapshot, but it can be stale). The relevance
  // verdicts are cached so this is cheap; skipCorpusWrite keeps it side-effect-free.
  const { curate } = await curateInProcess(root, { skipCorpusWrite: true });
  const skipped = curate.skippedDocs ?? [];
  const decisions = readCorpusDecisions(root);
  const manualIncludes = decisions.manualIncludes ?? [];
  const manualExcludes = decisions.manualExcludes ?? [];

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
  if (manualExcludes.length > 0) {
    p.log.message('');
    p.log.step(`Manual excludes (${manualExcludes.length})`);
    for (const ex of manualExcludes) p.log.message(`  ${ex}`);
  }
  p.outro(
    'Force-include a skipped doc with `spec docs include <path>`; force-exclude a kept doc with `spec docs exclude <path>`.',
  );
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

export async function runSpecDocsExclude(docPath: string, opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  if (!docPath) return fail('Missing doc path');
  await addManualExclude(root, docPath);
  await reScan(root);
  p.outro(`Force-exclude ${docPath} — re-scanned. Review \`truecourse spec conflicts list\`.`);
}

export async function runSpecDocsUnexclude(docPath: string, opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  if (!docPath) return fail('Missing doc path');
  await removeManualExclude(root, docPath);
  await reScan(root);
  p.outro(`Removed force-exclude for ${docPath} — re-scanned.`);
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
