/**
 * `truecourse spec docs <sub>` — relevance-filter overrides (corpus path).
 *
 *   list                                  list the kept (corpus) docs + area tags
 *   skipped                               list docs the LLM filter dropped
 *   include     <path...>                 force-include skipped docs + one re-scan
 *   uninclude   <path>                    remove a force-include override + re-scan
 *   exclude     <path...>                 force-exclude kept docs + one re-scan
 *   unexclude   <path>                    remove a force-exclude override + re-scan
 *
 * Force-includes (decisions.json#manualIncludes) bypass the relevance filter;
 * force-excludes (decisions.json#manualExcludes) drop an otherwise-kept doc from
 * the corpus. Both apply on the next curate; a force-exclude wins over a
 * force-include for the same path.
 */

import * as p from '@clack/prompts';
import { readCorpusDecisions } from '@truecourse/spec-consolidator';
import { hasMarkdownExtension, MARKDOWN_DOC_EXTENSIONS } from '@truecourse/shared';
import {
  addManualInclude,
  removeManualInclude,
  addManualExclude,
  removeManualExclude,
  curateInProcess,
  getCorpus,
} from '@truecourse/core/commands/spec-in-process';
import { installLlmTransportOrExit } from '../lib/claude-preflight.js';

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
  installLlmTransportOrExit();
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

// Force-include one or more skipped docs, then re-curate ONCE. Each path is
// validated + persisted first (idempotent), so recording five docs costs one scan
// instead of five.
export async function runSpecDocsInclude(docPaths: string[], opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  const paths = docPaths.filter(Boolean);
  if (paths.length === 0) return fail('Missing doc path');
  // A force-include bypasses the relevance filter, NOT discovery — and
  // discovery only ever yields markdown. Persisting a non-markdown path would
  // print "Force-included", re-scan, and change nothing, so the mistake is
  // caught here where it can still be corrected. Validate the whole batch
  // before persisting any of it, so one bad path leaves nothing half-recorded.
  const unsupported = paths.filter((docPath) => !hasMarkdownExtension(docPath));
  if (unsupported.length > 0) {
    return fail(
      `Not a markdown document: ${unsupported.join(', ')}\n` +
        `Only ${MARKDOWN_DOC_EXTENSIONS.join(', ')} files are discovered, so a force-include ` +
        `cannot bring these into the corpus.`,
    );
  }
  for (const docPath of paths) {
    await addManualInclude(root, docPath);
    p.log.step(`Force-included ${docPath}`);
  }
  await reScan(root);
  p.outro(
    paths.length === 1
      ? `Force-include ${paths[0]} — re-scanned. Review \`truecourse spec conflicts list\`.`
      : `Force-included ${paths.length} docs — re-scanned once. Review \`truecourse spec conflicts list\`.`,
  );
}

export async function runSpecDocsUninclude(docPath: string, opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  if (!docPath) return fail('Missing doc path');
  await removeManualInclude(root, docPath);
  await reScan(root);
  p.outro(`Removed force-include for ${docPath} — re-scanned.`);
}

// Force-exclude one or more kept docs, then re-curate ONCE. Each path is validated +
// persisted first (idempotent), so excluding five docs costs one scan instead of five.
export async function runSpecDocsExclude(docPaths: string[], opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  const paths = docPaths.filter(Boolean);
  if (paths.length === 0) return fail('Missing doc path');
  for (const docPath of paths) {
    await addManualExclude(root, docPath);
    p.log.step(`Force-excluded ${docPath}`);
  }
  await reScan(root);
  p.outro(
    paths.length === 1
      ? `Force-exclude ${paths[0]} — re-scanned. Review \`truecourse spec conflicts list\`.`
      : `Force-excluded ${paths.length} docs — re-scanned once. Review \`truecourse spec conflicts list\`.`,
  );
}

export async function runSpecDocsUnexclude(docPath: string, opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  if (!docPath) return fail('Missing doc path');
  await removeManualExclude(root, docPath);
  await reScan(root);
  p.outro(`Removed force-exclude for ${docPath} — re-scanned.`);
}

async function reScan(root: string): Promise<void> {
  installLlmTransportOrExit();
  const s = p.spinner();
  s.start('Re-scanning');
  await curateInProcess(root);
  s.stop('Re-scanned');
}

function fail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}
