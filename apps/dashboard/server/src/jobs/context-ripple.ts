/**
 * The CONTEXT RIPPLE — what a finished workspace Document scan means for the
 * repositories that read it.
 *
 * A repository's spec IS the workspace corpus cut down to the sources it is
 * linked to (its SLICE), so a scan that changed the corpus makes some
 * repositories' scenarios stale and leaves the rest exactly as they were. This
 * module decides which, and starts each one where it actually needs starting:
 *
 *   - nothing set up yet  → Test setup, which chains generate → the baseline run;
 *   - already set up      → Test generation, which chains the baseline run.
 *
 * Three gates keep it cheap and calm — the EE inheritance ripple's, ported:
 *
 *   - CHANGED-ONLY — the scan compares the corpus's volatile-zeroed signature
 *     before and after; an unchanged corpus ripples nothing.
 *   - CONFLICT-FREE ONLY — a workspace with an open conflict keeps every
 *     repository on the last clean spec rather than starting N runs against a
 *     corpus a human still has to settle. The scan's own notification says so.
 *   - SLICE-CHANGED ONLY — a repository whose own documents did not move is
 *     left alone, however much the rest of the workspace moved.
 *
 * And a repository whose Test setup is already queued or running is skipped:
 * connecting one starts its setup before any scan exists, and that setup
 * chains its own generate.
 *
 * A repository's LINKS changing is the other way its slice moves — with the
 * corpus standing still, so no scan is owed. `rippleLinksChanged` gives that
 * one repository the same treatment under the same gates.
 *
 * Quiet by construction: the scan posts ONE notification and the rippled jobs
 * post none of their own until they settle (a job notifies on its outcome, never
 * on being enqueued). A repository already working loses the single-flight race
 * and is simply skipped — its running job will read the stored corpus.
 *
 * Best-effort throughout: a ripple that cannot be started is logged, never
 * thrown into the completed scan's terminal path.
 */

import { log } from '@truecourse/core/lib/logger';
import { corpusContentSha } from '@truecourse/core/commands/spec-in-process';
import { sliceCorpus } from '@truecourse/core/services/context';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';

/** One repository the ripple may start, with the sources it reads. */
export interface RippleRepo {
  repoId: string;
  repoFullName: string;
  /** The source ids this repository is linked to — what its slice is cut to. */
  sourceIds: string[];
}

/** What the ripple did for one repository. */
export interface RippleStart {
  repoFullName: string;
  job: 'guard-setup' | 'guard-generate';
}

export interface ContextRippleDeps {
  workspaceOrgId: string;
  /** The repositories of the workspace, with their links. */
  listRepos(): Promise<RippleRepo[]>;
  /** Whether the repository already has a stored setup bundle. */
  hasSetup(repoFullName: string): Promise<boolean>;
  /**
   * Whether a Test setup is ALREADY queued or running for the repository — a
   * connect starts one from the sync's settle hook before this scan exists, and
   * that setup chains its own generate. The single-flight key would refuse a
   * second enqueue anyway; asking outright means the ripple never depends on
   * winning that race, and never reports a start it did not make.
   */
  isSettingUp(repoFullName: string): Promise<boolean>;
  /** Enqueue Test setup. Returns false when the repository is already working. */
  startSetup(repo: RippleRepo): Promise<boolean>;
  /** Enqueue Test generation. Returns false when the repository is already working. */
  startGenerate(repo: RippleRepo): Promise<boolean>;
}

export interface ContextRippleInput {
  /** The corpus the scan replaced (null on the workspace's first scan). */
  previousCorpus: CuratedCorpus | null;
  corpus: CuratedCorpus;
  /** The scan's own before/after verdict on the whole corpus. */
  corpusChanged: boolean;
  /** Open conflicts left on the workspace corpus — any at all stops the ripple. */
  openConflicts: number;
}

/**
 * Did this repository's slice move? Compared on the same volatile-zeroed
 * signature the whole-corpus gate uses, so a re-scan that only re-stamped
 * timestamps ripples nothing — and a repository that had no slice and now has
 * one (its first documents) counts as changed.
 */
export function sliceChanged(
  previous: CuratedCorpus | null,
  next: CuratedCorpus,
  sourceIds: readonly string[],
): boolean {
  const before = previous ? sliceCorpus(previous, sourceIds) : null;
  const after = sliceCorpus(next, sourceIds);
  return corpusContentSha(before) !== corpusContentSha(after);
}

/**
 * Start what ONE repository whose slice moved needs: nothing while its setup
 * is already in flight (that run reads the stored corpus and chains its own
 * generate), Test generation once it has been set up, Test setup before. Null
 * when nothing started — the repository is already working, and its running
 * job will read the stored corpus.
 */
async function startRepo(deps: ContextRippleDeps, repo: RippleRepo): Promise<RippleStart | null> {
  if (await deps.isSettingUp(repo.repoFullName)) {
    log.info(`[context] ${repo.repoFullName} is already setting up — nothing started`);
    return null;
  }
  const job = (await deps.hasSetup(repo.repoFullName)) ? 'guard-generate' : 'guard-setup';
  const queued =
    job === 'guard-setup' ? await deps.startSetup(repo) : await deps.startGenerate(repo);
  if (queued) return { repoFullName: repo.repoFullName, job };
  log.info(`[context] ${repo.repoFullName} is already working — nothing started`);
  return null;
}

/** Start what each repository whose slice changed needs. Never throws. */
export async function rippleContextScan(
  deps: ContextRippleDeps,
  input: ContextRippleInput,
): Promise<RippleStart[]> {
  if (!input.corpusChanged) return [];
  if (input.openConflicts > 0) {
    log.info(
      `[context] ${deps.workspaceOrgId}: ${input.openConflicts} open conflict(s) — nothing rippled`,
    );
    return [];
  }
  const started: RippleStart[] = [];
  try {
    for (const repo of await deps.listRepos()) {
      if (!sliceChanged(input.previousCorpus, input.corpus, repo.sourceIds)) continue;
      // A repository with no slice at all has nothing to generate against.
      if (sliceCorpus(input.corpus, repo.sourceIds) === null) continue;
      try {
        const start = await startRepo(deps, repo);
        if (start) started.push(start);
      } catch (err) {
        log.warn(
          `[context] could not ripple to ${repo.repoFullName}: ${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    log.warn(`[context] ripple for ${deps.workspaceOrgId} failed: ${(err as Error).message}`);
  }
  return started;
}

export interface LinksChangedInput {
  /** The workspace corpus as stored (null before the workspace's first scan). */
  corpus: CuratedCorpus | null;
  /** Open conflicts on that corpus — any at all stops the start, as for the ripple. */
  openConflicts: number;
  /** The repository, with the links it now has. */
  repo: RippleRepo;
}

/**
 * A repository's links changed: its slice moved while the corpus stood still.
 * Under the ripple's gates — a corpus that holds a document of its sources, no
 * open conflict — the repository gets what the ripple would give it. Throws
 * nothing; a start that fails is logged, since the links are saved either way.
 */
export async function rippleLinksChanged(
  deps: ContextRippleDeps,
  input: LinksChangedInput,
): Promise<RippleStart | null> {
  if (input.corpus === null || sliceCorpus(input.corpus, input.repo.sourceIds) === null) return null;
  if (input.openConflicts > 0) {
    log.info(
      `[context] ${deps.workspaceOrgId}: ${input.openConflicts} open conflict(s) — ${input.repo.repoFullName} not started`,
    );
    return null;
  }
  try {
    return await startRepo(deps, input.repo);
  } catch (err) {
    log.warn(`[context] could not start ${input.repo.repoFullName}: ${(err as Error).message}`);
    return null;
  }
}
