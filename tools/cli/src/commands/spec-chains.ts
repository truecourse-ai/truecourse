/**
 * `truecourse spec chains <sub>` — manual supersession surface.
 *
 *   list                                       [--json]    list all chains
 *   add    --older PATH --newer PATH [--note]              mark a chain
 *   remove --older PATH --newer PATH                       drop a chain
 */

import * as p from '@clack/prompts';
import { readDecisions } from '@truecourse/spec-consolidator';
import {
  addManualChain,
  removeManualChain,
  scanInProcess,
} from '@truecourse/core/commands/spec-in-process';

export interface RunSpecChainsOptions {
  cwd?: string;
  json?: boolean;
}

const repoRoot = (opts: RunSpecChainsOptions): string => opts.cwd ?? process.cwd();

export async function runSpecChainsList(opts: RunSpecChainsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  const decisions = readDecisions(root);
  const manual = decisions.manualChains ?? [];
  if (opts.json) {
    process.stdout.write(JSON.stringify({ manual }, null, 2) + '\n');
    return;
  }
  p.intro('Manual chains');
  if (manual.length === 0) p.log.step('(none)');
  for (const c of manual) {
    p.log.message(`  ${c.older}  →  ${c.newer}  ${c.note ? `· ${c.note}` : ''}`);
  }
  p.outro('');
}

export async function runSpecChainsAdd(
  opts: RunSpecChainsOptions & { older: string; newer: string; note?: string },
): Promise<void> {
  const root = repoRoot(opts);
  if (opts.older === opts.newer) return fail('older and newer must be different docs', !!opts.json);
  addManualChain(root, { older: opts.older, newer: opts.newer, note: opts.note });
  await scanInProcess(root, {});
  emitOk(`Marked ${opts.older} as superseded by ${opts.newer}`, !!opts.json, {
    older: opts.older,
    newer: opts.newer,
  });
}

export async function runSpecChainsRemove(
  opts: RunSpecChainsOptions & { older: string; newer: string },
): Promise<void> {
  const root = repoRoot(opts);
  removeManualChain(root, { older: opts.older, newer: opts.newer });
  await scanInProcess(root, {});
  emitOk(`Removed chain ${opts.older} → ${opts.newer}`, !!opts.json, {
    older: opts.older,
    newer: opts.newer,
  });
}

function emitOk(msg: string, json: boolean, payload: object): void {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, ...payload }, null, 2) + '\n');
    return;
  }
  p.outro(msg);
}

function fail(msg: string, json: boolean): never {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + '\n');
    process.exit(1);
  }
  p.cancel(msg);
  process.exit(1);
}
