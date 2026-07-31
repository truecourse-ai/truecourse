/**
 * Shared in-process entry points for `truecourse spec source` — the web half of
 * the doc universe (llms.txt-enabled documentation sites). Both the CLI and the
 * dashboard server import these so the confirm gate, the progress wiring, and
 * the `.truecourse/` bootstrap live in exactly one place — the same split
 * `spec-in-process.ts` gives the scan.
 *
 * No LLM call happens here: add/refresh are pure fetching, so there is no cost
 * estimate. The docs they materialize are priced by the next `spec scan`, which
 * sees them through its own pre-flight.
 */

import {
  addSource,
  listSources,
  previewSource,
  refreshSource,
  removeSource,
  SourceNotFoundError,
  type AddSourceResult,
  type FetchOptions,
  type RefreshSourceResult,
  type SourcePreview,
  type SpecSource,
} from '@truecourse/spec-consolidator';
import { ensureRepoTruecourseDir } from '../config/paths.js';
import type { StepTracker } from '../progress.js';

/** The two phases of an `add`: read the llms.txt, then fetch what it lists. */
export const SOURCE_ADD_STEPS = [
  { key: 'fetch', label: 'Fetching llms.txt' },
  { key: 'pages', label: 'Fetching pages' },
] as const;

/** Progress-step key of one source in a refresh. */
export function refreshStepKey(sourceId: string): string {
  return `source:${sourceId}`;
}

/** One step per source a refresh targets, so N sources render as N lines. */
export function sourceRefreshSteps(
  sources: readonly SpecSource[],
): { key: string; label: string }[] {
  return sources.map((source) => ({
    key: refreshStepKey(source.id),
    label: `Refreshing ${source.title}`,
  }));
}

/**
 * Thrown when the caller declines the fetch at `onConfirm`. An `add` pulls a
 * whole documentation site over the network, so the page count is shown first
 * and a decline aborts the command — the `EstimateDeclined` shape, for the same
 * reason.
 */
export class SourceFetchDeclined extends Error {
  constructor(public readonly llmsTxtUrl: string) {
    super(`fetch declined for ${llmsTxtUrl}`);
    this.name = 'SourceFetchDeclined';
  }
}

/** Progress reaches the caller through the tracker, not a raw callback. */
export interface AddSpecSourceOptions extends Omit<FetchOptions, 'onProgress'> {
  tracker?: StepTracker;
  /** Override the id derived from the llms.txt URL. */
  id?: string;
  /**
   * Shown what the llms.txt lists before anything is fetched; returning false
   * aborts with {@link SourceFetchDeclined}. Omit to fetch without asking — the
   * preview request is then skipped too.
   */
  onConfirm?: (preview: SourcePreview) => boolean | Promise<boolean>;
}

/**
 * Register a docs site and snapshot every markdown page its llms.txt lists.
 */
export async function addSpecSourceInProcess(
  repoRoot: string,
  llmsTxtUrl: string,
  options: AddSpecSourceOptions = {},
): Promise<AddSourceResult> {
  const { tracker, onConfirm, id, ...fetchOptions } = options;
  ensureRepoTruecourseDir(repoRoot);

  // Preview + confirm before the first tracker event: the caller's prompt owns
  // the terminal until it's answered, exactly like the scan's estimate gate.
  if (onConfirm) {
    const preview = await previewSource(llmsTxtUrl, fetchOptions);
    if (!(await onConfirm(preview))) throw new SourceFetchDeclined(preview.llmsTxtUrl);
  }

  tracker?.start('fetch');
  let pagesStarted = false;
  try {
    const result = await addSource(repoRoot, llmsTxtUrl, {
      ...fetchOptions,
      id,
      onProgress: ({ done, total }) => {
        // The first event is the page pool's own "0 of N" — i.e. the llms.txt
        // has been read and parsed, and fetching is what runs from here.
        if (!pagesStarted) {
          pagesStarted = true;
          tracker?.done('fetch', `${total} page${total === 1 ? '' : 's'}`);
          tracker?.start('pages');
        }
        tracker?.detail('pages', `fetched ${done}/${total}`);
      },
    });
    tracker?.done('pages', fetchSummary(result.written, result.skipped.length));
    return result;
  } catch (err) {
    tracker?.error(pagesStarted ? 'pages' : 'fetch', (err as Error).message);
    throw err;
  }
}

function fetchSummary(written: number, skipped: number): string {
  return skipped > 0 ? `${written} written · ${skipped} skipped` : `${written} written`;
}

export interface RefreshSpecSourcesOptions extends Omit<FetchOptions, 'onProgress'> {
  tracker?: StepTracker;
  /** Refresh only this source. Omit for every registered one. */
  sourceId?: string;
}

/**
 * Refetch registered sources and reconcile their snapshots with the sites.
 *
 * Sources are refreshed in order and each one persists as it finishes, so a
 * site that is unreachable aborts the run without discarding the work already
 * done — re-running picks up where it stopped.
 */
export async function refreshSpecSourcesInProcess(
  repoRoot: string,
  options: RefreshSpecSourcesOptions = {},
): Promise<RefreshSourceResult[]> {
  const { tracker, sourceId, ...fetchOptions } = options;
  const results: RefreshSourceResult[] = [];
  for (const target of resolveSpecSources(repoRoot, sourceId)) {
    const key = refreshStepKey(target.id);
    tracker?.start(key);
    try {
      const result = await refreshSource(repoRoot, target.id, {
        ...fetchOptions,
        onProgress: ({ done, total }) => tracker?.detail(key, `fetched ${done}/${total}`),
      });
      tracker?.done(key, refreshSummary(result));
      results.push(result);
    } catch (err) {
      tracker?.error(key, (err as Error).message);
      throw err;
    }
  }
  return results;
}

function refreshSummary(result: RefreshSourceResult): string {
  const parts = [
    `${result.added.length} added`,
    `${result.changed.length} changed`,
    `${result.removed.length} removed`,
    `${result.unchanged.length} unchanged`,
  ];
  if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);
  return parts.join(' · ');
}

/**
 * The sources a command targets: the one named by `sourceId` (throws
 * {@link SourceNotFoundError}) or every registered one. Exported because
 * callers build their progress steps from it before the run starts.
 */
export function resolveSpecSources(repoRoot: string, sourceId?: string): SpecSource[] {
  const sources = listSources(repoRoot);
  if (!sourceId) return sources;
  const match = sources.find((source) => source.id === sourceId);
  if (!match) throw new SourceNotFoundError(sourceId);
  return [match];
}

export function listSpecSourcesInProcess(repoRoot: string): SpecSource[] {
  return listSources(repoRoot);
}

/** Drop a source: its snapshot directory and its registry entry. */
export function removeSpecSourceInProcess(repoRoot: string, sourceId: string): SpecSource {
  return removeSource(repoRoot, sourceId);
}
