/**
 * `truecourse spec docs <sub>` — relevance-filter overrides.
 *
 *   skipped                               list docs the LLM filter dropped
 *   include     <path>                    force-include a skipped doc
 *   uninclude   <path>                    remove a force-include override
 */

import * as p from '@clack/prompts';
import { readDecisions, readScanState } from '@truecourse/spec-consolidator';
import {
  addManualInclude,
  removeManualInclude,
  scanInProcess,
} from '@truecourse/core/commands/spec-in-process';

export interface RunSpecDocsOptions {
  cwd?: string;
}

const repoRoot = (opts: RunSpecDocsOptions): string => opts.cwd ?? process.cwd();

export async function runSpecDocsSkipped(opts: RunSpecDocsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  const scan = readScanState(root);
  const decisions = readDecisions(root);
  const skipped = (scan?.skippedDocs ?? []) as Array<{ path: string; reason: string }>;
  const manualIncludes = decisions.manualIncludes ?? [];
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
  p.outro('');
}

export async function runSpecDocsInclude(
  docPath: string,
  opts: RunSpecDocsOptions = {},
): Promise<void> {
  const root = repoRoot(opts);
  if (!docPath) return fail('Missing doc path');
  addManualInclude(root, docPath);
  await scanInProcess(root, {});
  emitOk(`Force-include ${docPath}`);
}

export async function runSpecDocsUninclude(
  docPath: string,
  opts: RunSpecDocsOptions = {},
): Promise<void> {
  const root = repoRoot(opts);
  if (!docPath) return fail('Missing doc path');
  removeManualInclude(root, docPath);
  await scanInProcess(root, {});
  emitOk(`Removed force-include for ${docPath}`);
}

function emitOk(msg: string): void {
  p.outro(msg);
}

function fail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}
