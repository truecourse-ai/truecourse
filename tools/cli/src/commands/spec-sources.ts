/**
 * `truecourse spec source <sub>` — llms.txt documentation sites as spec docs.
 *
 *   add <llms-txt-url>   read the llms.txt, confirm, snapshot every markdown page
 *   list                 registered sources: title, pages, last fetch, llms.txt URL
 *   refresh [id]         refetch and reconcile (every source when id is omitted)
 *   remove <id>          delete the snapshot + the registry entry
 *
 * Pure fetching: nothing here calls an LLM, so there is no cost estimate — the
 * pages it materializes are priced by the next `spec scan`. The snapshot lands
 * under `.truecourse/specs/sources/<id>/` as real markdown files, which is what
 * every downstream consumer (scan, guard generate, the doc viewer) reads.
 */

import * as p from '@clack/prompts';
import {
  SourceExistsError,
  SourceNotFoundError,
  type SourcePreview,
  type SourceSkip,
  type SpecSource,
} from '@truecourse/spec-consolidator';
import { StepTracker } from '@truecourse/core/progress';
import {
  addSpecSourceInProcess,
  listSpecSourcesInProcess,
  refreshSpecSourcesInProcess,
  removeSpecSourceInProcess,
  resolveSpecSources,
  sourceRefreshSteps,
  SourceFetchDeclined,
  SOURCE_ADD_STEPS,
} from '@truecourse/core/commands/spec-sources';
import { createStdoutStepRenderer } from '../lib/stdout-step-renderer.js';
import { isInteractive } from './helpers.js';

export interface RunSpecSourceOptions {
  cwd?: string;
  /** Skip the fetch confirmation (`--yes`). */
  yes?: boolean;
  /** Override the source id derived from the llms.txt URL (`--id`). */
  id?: string;
}

const repoRoot = (opts: RunSpecSourceOptions = {}): string => opts.cwd ?? process.cwd();

const SCAN_HINT = 'Run `truecourse spec scan` to fold the new docs into the corpus.';

function withTracker(stepDefs: readonly { key: string; label: string }[]) {
  const renderer = createStdoutStepRenderer();
  const tracker = new StepTracker(renderer.onProgress, stepDefs.map((s) => ({ ...s })));
  return { renderer, tracker };
}

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

export async function runSpecSourceAdd(
  llmsTxtUrl: string,
  opts: RunSpecSourceOptions = {},
): Promise<void> {
  const root = repoRoot(opts);
  p.intro('Add spec source');

  // Set when the confirm was refused only because there was no TTY to ask —
  // a scripted caller that forgot `--yes`, which is an error, not a decline.
  let nonInteractive = false;
  const onConfirm = async (preview: SourcePreview): Promise<boolean> => {
    const skipped = preview.totalLinks - preview.fetchableLinks;
    p.log.step(
      `Found "${preview.title}" — ${preview.totalLinks} page${preview.totalLinks === 1 ? '' : 's'} ` +
        `(${preview.fetchableLinks} fetchable, ${skipped} skipped)`,
    );
    if (opts.yes) return true;
    if (!isInteractive()) {
      nonInteractive = true;
      return false;
    }
    const proceed = await p.confirm({ message: 'Fetch now?', initialValue: true });
    return !p.isCancel(proceed) && !!proceed;
  };

  const { renderer, tracker } = withTracker(SOURCE_ADD_STEPS);
  const result = await addSpecSourceInProcess(root, llmsTxtUrl, {
    tracker,
    id: opts.id,
    onConfirm,
  }).catch((e: unknown) => {
    renderer.dispose();
    if (e instanceof SourceFetchDeclined) {
      if (nonInteractive) {
        fail('Cannot prompt for confirmation non-interactively. Pass --yes to fetch the listed pages.');
      }
      p.cancel('Cancelled — nothing fetched.');
      process.exit(0);
    }
    failSource(root, e);
  });
  renderer.dispose();

  const { source, written, skipped } = result;
  p.log.step(`source      ${source.id}  —  ${source.title}`);
  p.log.step(`pages       ${written} written${skipped.length > 0 ? ` · ${skipped.length} skipped` : ''}`);
  p.log.step(`snapshot    .truecourse/specs/sources/${source.id}/`);
  printSkipped(skipped);
  p.outro(SCAN_HINT);
}

// ---------------------------------------------------------------------------
// list — a pure read of sources.json (no network)
// ---------------------------------------------------------------------------

export async function runSpecSourceList(opts: RunSpecSourceOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro('Spec sources');
  const sources = readSources(root);
  if (sources.length === 0) {
    p.log.warn('No sources registered.');
    p.outro('Add one with `truecourse spec source add <llms-txt-url>`.');
    return;
  }
  for (const source of sources) {
    p.log.message(
      `  ${source.id}  —  ${source.title}\n` +
        `    ${pageCount(source.docs.length)} · fetched ${source.fetchedAt}\n` +
        `    ${source.llmsTxtUrl}`,
    );
  }
  p.outro('Refresh one with `truecourse spec source refresh <id>`.');
}

// ---------------------------------------------------------------------------
// refresh
// ---------------------------------------------------------------------------

export async function runSpecSourceRefresh(
  sourceId?: string,
  opts: RunSpecSourceOptions = {},
): Promise<void> {
  const root = repoRoot(opts);
  p.intro('Refresh spec sources');
  let targets: SpecSource[];
  try {
    targets = resolveSpecSources(root, sourceId);
  } catch (e) {
    failSource(root, e);
  }
  if (targets.length === 0) {
    p.log.warn('No sources registered.');
    p.outro('Add one with `truecourse spec source add <llms-txt-url>`.');
    return;
  }

  const { renderer, tracker } = withTracker(sourceRefreshSteps(targets));
  const results = await refreshSpecSourcesInProcess(root, { sourceId, tracker }).catch(
    (e: unknown) => {
      renderer.dispose();
      failSource(root, e);
    },
  );
  renderer.dispose();

  let changedAny = false;
  for (const result of results) {
    const { added, changed, removed, unchanged, skipped } = result;
    if (added.length + changed.length + removed.length > 0) changedAny = true;
    const lines = [
      `${added.length} added · ${changed.length} changed · ${removed.length} removed · ${unchanged.length} unchanged`,
      ...added.map((docPath) => `  + ${docPath}`),
      ...changed.map((docPath) => `  ~ ${docPath}`),
      ...removed.map((docPath) => `  - ${docPath}`),
    ];
    p.log.step(`${result.source.id}  —  ${result.source.title}\n${lines.map((line) => `  ${line}`).join('\n')}`);
    printSkipped(skipped);
  }
  p.outro(changedAny ? SCAN_HINT : 'Everything is up to date — no page changed.');
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

export async function runSpecSourceRemove(
  sourceId: string,
  opts: RunSpecSourceOptions = {},
): Promise<void> {
  const root = repoRoot(opts);
  p.intro('Remove spec source');
  // No confirmation: `spec source add <url>` restores everything this deletes.
  let removed: SpecSource;
  try {
    removed = removeSpecSourceInProcess(root, sourceId);
  } catch (e) {
    failSource(root, e);
  }
  p.log.step(`Removed ${removed.id}  —  ${removed.title} (${pageCount(removed.docs.length)})`);
  p.outro('Run `truecourse spec scan` to drop its docs from the corpus.');
}

// ---------------------------------------------------------------------------
// Rendering + failure helpers
// ---------------------------------------------------------------------------

function pageCount(n: number): string {
  return `${n} page${n === 1 ? '' : 's'}`;
}

function printSkipped(skipped: readonly SourceSkip[]): void {
  if (skipped.length === 0) return;
  const lines = skipped.map(
    (skip) => `  • ${skip.url}\n      ${skip.reason}${skip.detail ? ` — ${skip.detail}` : ''}`,
  );
  p.log.message(`Skipped (no page written) — ${skipped.length}:\n${lines.join('\n')}`);
}

function readSources(root: string): SpecSource[] {
  try {
    return listSpecSourcesInProcess(root);
  } catch (e) {
    failSource(root, e);
  }
}

/**
 * Turn an engine failure into one clean message. The typed errors already carry
 * user-facing text, so it prints verbatim; the two that have an obvious next
 * command get it appended.
 */
function failSource(root: string, err: unknown): never {
  if (err instanceof SourceNotFoundError) {
    const known = listSpecSourcesInProcess(root).map((source) => source.id);
    return fail(
      known.length === 0
        ? `${err.message} — nothing is registered yet. Add one with \`truecourse spec source add <llms-txt-url>\`.`
        : `${err.message}. Registered: ${known.join(', ')}.`,
    );
  }
  if (err instanceof SourceExistsError) {
    return fail(
      `${err.message}.\n\nRun \`truecourse spec source refresh ${err.id}\` to update it, ` +
        `or register this URL under another id with --id <slug>.`,
    );
  }
  return fail(err instanceof Error ? err.message : String(err));
}

function fail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}
