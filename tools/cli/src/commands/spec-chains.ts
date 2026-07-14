/**
 * `truecourse spec chains <sub>` — doc→doc relation surface (the corpus model's
 * supersession/precedence overrides; generalizes the old manual version chains).
 *
 *   list                                              all effective relations
 *   add    --older P --newer P [--type T] [--scope A] [--note]   record a relation
 *   remove --older P --newer P [--scope A]            drop a user relation
 *
 * `--type` is one of replace (default; `newer` supersedes `older`) / precedence
 * (`newer` wins where they overlap, `older`'s unique content survives) /
 * keep-both. `--scope` confines the relation to one area id (`product/concern`).
 */

import * as p from '@clack/prompts';
import { readCorpus, readCorpusDecisions } from '@truecourse/spec-consolidator';
import type { Relation, RelationType } from '@truecourse/spec-consolidator';
import { addRelation, removeRelation, curateInProcess } from '@truecourse/core/commands/spec-in-process';

export interface RunSpecChainsOptions {
  cwd?: string;
}

const repoRoot = (opts: RunSpecChainsOptions): string => opts.cwd ?? process.cwd();
const RELATION_TYPES: RelationType[] = ['replace', 'precedence', 'keep-both'];

export async function runSpecChainsList(opts: RunSpecChainsOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  const corpus = readCorpus(root);
  const auto = corpus?.relations ?? [];
  const user = readCorpusDecisions(root).relations ?? [];
  p.intro('Relations (doc → doc)');
  const render = (r: Relation, src: string): void =>
    p.log.message(
      `  ${r.type.padEnd(10)} ${r.older}  ⇒  ${r.newer}${r.scope ? `  [${r.scope}]` : ''}  · ${src}${r.note ? ` — ${r.note}` : ''}`,
    );
  if (user.length) {
    p.log.step(`User-authored (${user.length})`);
    for (const r of user) render(r, 'user');
  }
  if (auto.length) {
    p.log.step(`Auto-detected (${auto.length})`);
    for (const r of auto) render(r, r.detectedFrom ?? 'auto');
  }
  if (!user.length && !auto.length) p.log.step('(none)');
  p.outro('add/remove with `truecourse spec chains add|remove`.');
}

export async function runSpecChainsAdd(
  opts: RunSpecChainsOptions & { older: string; newer: string; type?: string; scope?: string; note?: string },
): Promise<void> {
  const root = repoRoot(opts);
  if (opts.older === opts.newer) return fail('older and newer must be different docs');
  const type = (opts.type ?? 'replace') as RelationType;
  if (!RELATION_TYPES.includes(type)) return fail(`--type must be one of ${RELATION_TYPES.join(' | ')}`);

  await addRelation(root, {
    type,
    older: opts.older,
    newer: opts.newer,
    scope: opts.scope,
    detectedFrom: 'manual',
    note: opts.note,
  });
  await reScan(root);
  emitOk(
    `Recorded ${type}: ${opts.older} ⇒ ${opts.newer}${opts.scope ? ` [${opts.scope}]` : ''}`,
  );
}

export async function runSpecChainsRemove(
  opts: RunSpecChainsOptions & { older: string; newer: string; scope?: string },
): Promise<void> {
  const root = repoRoot(opts);
  await removeRelation(root, { older: opts.older, newer: opts.newer, scope: opts.scope });
  await reScan(root);
  emitOk(`Removed relation ${opts.older} ⇒ ${opts.newer}${opts.scope ? ` [${opts.scope}]` : ''}`);
}

async function reScan(root: string): Promise<void> {
  const s = p.spinner();
  s.start('Re-scanning to apply');
  await curateInProcess(root);
  s.stop('Re-scanned');
}

function emitOk(msg: string): void {
  p.outro(msg);
}

function fail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}
