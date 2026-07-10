/**
 * Guard onboarding: generate a connected repo's guard scenarios server-side and
 * persist them to the hosted guard store — the guard analogue of `spec-scan.ts`.
 *
 * The pipeline shallow-clones the repo pinned at the request's commit, materializes the
 * Pg-STORED curated corpus (`specs/corpus.json`, produced by the baseline's spec
 * scan) into the checkout — the generator's only doc authority — then runs the
 * shared in-process guard generate (LLM stages through the process-global EE
 * transport; birth-validation through the guard executor seam) and persists the
 * resulting scenario corpus (`recipe.json` + `manifest.json` + `*.yaml`) plus the
 * generate report to the guard store keyed by `(owner/repo, commit)`.
 *
 * A repo with no curated corpus (none stored, none committed) is a CLEAN no-op
 * (`noCorpus: true`) — scenarios generate once the spec is scanned. The heavy
 * steps (clone, generate) are injectable defaults so tests exercise the real
 * pipeline body without a network or an LLM.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { loadSpec } from '@truecourse/core/lib/spec-store';
import {
  saveScenarios,
  writeGuardResult,
  type RepoRef,
} from '@truecourse/core/lib/guard-store';
import {
  guardGenerateInProcess,
  buildGuardReport,
  type GuardGenerateInProcessResult,
} from '@truecourse/core/commands/guard-in-process';
import { isLlmConfigured, NO_LLM_PROVIDER_MESSAGE } from '@truecourse/shared/llm';
import type { StepTracker } from '@truecourse/core/progress';
import { corpusFilePath } from '@truecourse/spec-consolidator';
import { scenariosDir, readGuardResult as readCloneGuardResult } from '@truecourse/guard-runner';
import { hasGuardUniverse } from '@truecourse/guard-generator';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';

export interface GuardOnboardingRequest {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  /** Default-branch head — everything persists under it. */
  commitSha: string;
}

export interface GuardOnboardingResult {
  /** Scenario-corpus files persisted (`recipe.json` + `manifest.json` + `*.yaml`). */
  savedFileCount: number;
  /** Scenarios written by the generate (passed birth-validation and settled). */
  scenariosWritten: number;
  /** No curated corpus (stored or committed) → clean no-op success. */
  noCorpus: boolean;
}

/** What the pipeline needs from the GitHub App (clone auth). */
export interface GuardOnboardingDeps {
  auth: GithubAuth;
}

/** Progress wiring for the EE job popup. */
export interface GuardOnboardingProgress {
  /** Coarse phase callback — advances the job's stepped checklist. */
  onPhase?: (phase: 'clone' | 'generate') => void | Promise<void>;
  /** Driven through GUARD_GENERATE_STEPS for the "Generating scenarios" detail. */
  generateTracker?: StepTracker;
}

export interface GuardOnboardingPipeline {
  run(
    deps: GuardOnboardingDeps,
    req: GuardOnboardingRequest,
    progress?: GuardOnboardingProgress,
  ): Promise<GuardOnboardingResult>;
}

/**
 * Write the Pg-stored curated corpus for `ref` into
 * `<checkout>/.truecourse/specs/corpus.json` — exactly where the guard
 * generator's section plan reads its doc universe (`corpusFilePath`). Returns
 * false when no corpus is stored for the ref (the caller decides the no-op).
 */
export async function materializeStoredCorpus(ref: RepoRef, checkoutDir: string): Promise<boolean> {
  const corpus = await loadSpec(ref, 'corpus');
  if (corpus == null) return false;
  const file = corpusFilePath(checkoutDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(corpus, null, 2) + '\n');
  return true;
}

/** The injectable heavy steps (network + LLM); production uses the defaults. */
export interface GuardOnboardingSeams {
  /** Shallow-clone the repo pinned to `req.commitSha` into `dir`. */
  cloneRepo?: (
    deps: GuardOnboardingDeps,
    req: GuardOnboardingRequest,
    dir: string,
  ) => Promise<void>;
  /** The in-process guard generate over the checkout. */
  generate?: (
    checkoutDir: string,
    tracker?: StepTracker,
  ) => Promise<GuardGenerateInProcessResult>;
}

async function defaultCloneRepo(
  deps: GuardOnboardingDeps,
  req: GuardOnboardingRequest,
  dir: string,
): Promise<void> {
  const token = await getInstallationToken(deps.auth, req.installationId);
  const auth = cloneAuthArgs(token);
  await simpleGit().clone(cloneUrl(req.repoFullName), dir, [
    ...auth,
    '--depth',
    '1',
    '--branch',
    req.defaultBranch,
  ]);
  const git = simpleGit(dir);
  // Drop the token the clone persisted into .git/config — defence in depth.
  // (Later commands pass auth args per invocation, the gate-runner convention.)
  await stripEmbeddedAuth(git);
  // Pin the checkout to the commit everything persists under: the branch head
  // may have moved since the baseline settled (or since the manual click), and
  // scenarios keyed to `commitSha` must be generated from that tree.
  const head = (await git.revparse(['HEAD'])).trim();
  if (head !== req.commitSha) {
    await git.raw([...auth, 'fetch', '--depth', '1', 'origin', req.commitSha]);
    await git.raw(['checkout', '-f', 'FETCH_HEAD']);
  }
}

export function createGuardOnboardingPipeline(
  seams: GuardOnboardingSeams = {},
): GuardOnboardingPipeline {
  const cloneRepo = seams.cloneRepo ?? defaultCloneRepo;
  const generate =
    seams.generate ??
    ((checkoutDir: string, tracker?: StepTracker) =>
      // No onLlmEstimate: there is no interactive cost gate in hosted mode. The
      // process-global EE transport + guard executor are picked up internally.
      guardGenerateInProcess(checkoutDir, { tracker }));

  return {
    async run(deps, req, progress = {}) {
      const ref: RepoRef = { repoKey: req.repoFullName, commitSha: req.commitSha };
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-guard-'));
      try {
        await progress.onPhase?.('clone');
        await cloneRepo(deps, req, tmp);

        // The corpus is generation's only doc authority. Prefer the one the
        // baseline stored for this commit; a repo that COMMITS its corpus (it is
        // committable) already carries one in the clone. Neither → clean no-op.
        const materialized = await materializeStoredCorpus(ref, tmp);
        if (!materialized && !hasGuardUniverse(tmp)) {
          return { savedFileCount: 0, scenariosWritten: 0, noCorpus: true };
        }

        // Fail loudly BEFORE any LLM work when no provider is configured — EE
        // must never fall back to the `claude` CLI (same rule as spec-scan).
        if (!isLlmConfigured()) throw new Error(NO_LLM_PROVIDER_MESSAGE);

        await progress.onPhase?.('generate');
        const { guard } = await generate(tmp, progress.generateTracker);

        // A corpus with an empty doc universe generates nothing — same user story
        // as no corpus: scenarios arrive once real spec docs are scanned.
        if (guard.status === 'no-docs') {
          return { savedFileCount: 0, scenariosWritten: 0, noCorpus: true };
        }
        if (guard.status !== 'ok') {
          throw new Error(guard.reason ?? `guard generation failed (${guard.status})`);
        }

        // Persist the scenario tree the generate wrote into the clone, then the
        // report — preferring the clone's file report (it carries the usage
        // totals the in-process driver stamped) over rebuilding from the result.
        const { fileCount } = await saveScenarios(ref, scenariosDir(tmp));
        const report =
          readCloneGuardResult(tmp) ?? buildGuardReport(guard, new Date().toISOString());
        await writeGuardResult(ref, report);

        return {
          savedFileCount: fileCount,
          scenariosWritten: guard.written.length,
          noCorpus: false,
        };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}

/** The production pipeline (real shallow clone + real in-process generate). */
export const defaultGuardOnboardingPipeline: GuardOnboardingPipeline =
  createGuardOnboardingPipeline();
