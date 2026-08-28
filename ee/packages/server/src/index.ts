/**
 * Enterprise server entry point.
 *
 * The OSS dashboard server discovers this module at boot through its
 * plugin loader (a guarded dynamic import — OSS never statically
 * imports `@truecourse/ee-server`). When enterprise mode is on and this
 * package resolves, the loader calls `register()`, which wires up
 * WorkOS SSO: the public auth routes and the session verifier the OSS
 * auth gate uses to protect the rest of the dashboard.
 */

import { WorkOS } from '@workos-inc/node';
import type { EePlugin } from '@truecourse/shared';
import { createDb, type Db } from '@truecourse/db';
import { WorkspaceSettingsStore, PgKnowledgeStore } from '@truecourse/ee-data-store';
import { log } from '@truecourse/core/lib/logger';
import { registerGithubApp, selectGateStore, loadGithubAppConfig, readRepoDocFromGithub, createGuardGateHeadsLookup, installationOctokit } from '@truecourse/ee-github-app';
import { setRepoDocReader } from '@truecourse/core/lib/repo-doc-reader';
import { setGuardGatePendingLookup, setGuardGateHeadsLookup } from '@truecourse/core/lib/guard-gate-pending';
import { setGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import { setGuardPrRegenEnqueue } from '@truecourse/core/lib/guard-pr-regen-enqueue';
import { setSpecConflictsResolvedHook } from '@truecourse/core/lib/spec-conflicts-resolved-hook';
import { setSpecInheritanceHook } from '@truecourse/core/lib/spec-inheritance-hook';
import { setKnowledgeLedgerReader, setKnowledgeDocBodyReader } from '@truecourse/core/lib/knowledge-ledger-reader';
import { createSpecInheritanceHook, createKnowledgeLedgerReader, createKnowledgeDocBodyReader } from './knowledge/inheritance.js';
import { guardGateJobKey } from './jobs/constants.js';
import { createWorkspaceRouter } from './workspace.js';
import { registerLlmProviders } from './llm/index.js';
import { registerIntegrations } from './integrations/index.js';
import { registerKnowledge } from './knowledge/index.js';
import { registerJobs } from './jobs/index.js';
import {
  createGuardRouter,
  createGuardGenerateEnqueue,
  createGuardPrRegenEnqueue,
  createSpecConflictsResolvedBaselineScan,
} from './guard/index.js';
import { registerAdmin } from './admin/index.js';
import { installEeStores, sweepStaleTempDirs } from './storage.js';
import { initSentry, flushSentry } from './observability/sentry.js';
import { EeLogTransport } from './observability/log-transport.js';
import { setLogTransport } from '@truecourse/core/lib/logger';

const plugin: EePlugin = {
  capabilities: ['sso', 'workspace'],
  async register(registry) {
    // EE-only error tracking. Initialised first so every seam below can report.
    // A no-op without SENTRY_DSN; never reports OSS errors (see observability/sentry.ts).
    initSentry();
    // Route the hosted server's logs to the terminal + Sentry (no log file). Also
    // gives the gate webhook a Sentry path — it logs via the core logger, which
    // now egresses errors through this transport (no upward import needed).
    setLogTransport(new EeLogTransport());
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      process.once(sig, () => {
        void flushSentry();
      });
    }

    // WorkOS session auth (routes + verifier) now lives in the dashboard server
    // itself. What remains here needs only a WorkOS client (workspace directory
    // reads) and the app URL (GitHub App install callbacks).
    const workos = new WorkOS(process.env.WORKOS_API_KEY ?? '', {
      clientId: process.env.WORKOS_CLIENT_ID ?? '',
    });
    const appUrl = process.env.WORKOS_APP_URL || 'http://localhost:3000';

    // The enterprise edition stores ALL per-repo state in Postgres — there is
    // no file fallback. DATABASE_URL is therefore REQUIRED; the stores are
    // always installed (every read/write goes to Postgres + the BlobStore, never
    // the customer's `.truecourse/` tree).
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        '[ee-server] DATABASE_URL is required: the enterprise edition stores all state in Postgres (no file fallback). Set DATABASE_URL to a Postgres instance.',
      );
    }

    // The GitHub App PR gate is the enterprise edition's core loop — connect a
    // repo, gate its pull requests — so EE cannot run without it. Validated up
    // front (env-only, no deps) so a misconfigured deploy fails fast rather than
    // booting half-wired. registerGithubApp below then always lights up.
    const githubAppConfig = loadGithubAppConfig();
    if (!githubAppConfig) {
      throw new Error(
        '[ee-server] GitHub App is required: the enterprise edition gates pull requests through a GitHub App (there is no SSO-only mode). Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_WEBHOOK_SECRET, and GITHUB_APP_SLUG.',
      );
    }

    const handle = await createDb(databaseUrl);
    const eeDb: Db = handle.db;
    log.info('[ee-server] db ready (Postgres, migrations applied)');
    const { traceStore } = installEeStores(handle);
    sweepStaleTempDirs();

    // Workspace data (SSO status + members + overview) — protected, behind the
    // gate. The overview is scoped to the org's connected repos (gh_repos), so it
    // never counts another workspace's repos. Registered after the db is ready.
    const gateStore = selectGateStore(eeDb);
    registry.registerRouter(
      '/api/ee/workspace',
      createWorkspaceRouter(
        workos,
        async (org) => (await gateStore.listReposForWorkspace(org)).map((r) => r.repoFullName),
        new WorkspaceSettingsStore(eeDb),
      ),
    );

    // TRUECOURSE_SECRET_KEY derives the AES key for every encrypted-at-rest
    // secret (LLM provider keys + integration tokens), so — like DATABASE_URL —
    // it is REQUIRED. Validated up front because Knowledge/Integrations below
    // need it. A missing/weak secret fails boot rather than running half-secure.
    const masterSecret = process.env.TRUECOURSE_SECRET_KEY;
    if (!masterSecret || masterSecret.length < 32) {
      throw new Error(
        '[ee-server] TRUECOURSE_SECRET_KEY (32+ characters) is required: the enterprise edition stores LLM provider keys + integration tokens encrypted in Postgres (no CLI/.env fallback). Set TRUECOURSE_SECRET_KEY to a strong secret.',
      );
    }

    // Background jobs + notifications: the in-process graphile-worker runner, the
    // LISTEN/NOTIFY event hub, and the SSE/jobs/notifications routers. Returns the
    // queue API the gate enqueues repo-baseline scans onto. jobs only run on demand,
    // by which point the LLM transport (below) is installed.
    const jobs = await registerJobs(registry, { db: eeDb, masterSecret, connectionString: databaseUrl });
    plugin.capabilities.push('jobs');

    // Settings → Integrations (encrypted connector tokens). Needs the Postgres
    // stores installed above + the master secret.
    registerIntegrations(registry, { db: eeDb, masterSecret });
    // Workspace Knowledge (connector sweep/process + corpus reads) — rides the
    // job queue for the sweep and processing stages.
    registerKnowledge(registry, { db: eeDb, masterSecret, jobs });
    plugin.capabilities.push('knowledge');

    // GitHub App PR gate — required (env validated at boot above, so this always
    // lights up `github-gate`). The repo scan (connect + push) runs on the
    // background job queue via enqueueBaseline.
    await registerGithubApp(registry, {
      appUrl,
      db: eeDb,
      enqueueBaseline: jobs.enqueueBaseline,
      enqueueGuardGate: jobs.enqueueGuardGate,
      enqueueGuardSpecRegen: jobs.enqueueGuardSpecRegen,
      codeAnalysisLlm: (org) => new WorkspaceSettingsStore(eeDb).codeAnalysisLlm(org),
    });
    plugin.capabilities.push('github-gate');

    // Hosted guard-scenario generation. The `repo.guard` job is registered by the
    // worker and chained onto the first successful baseline; this router is the
    // manual "Generate" trigger. The router mounts unconditionally (same rule as
    // the jobs routers — pure wiring), but the capability is advertised ONLY when
    // the background worker actually started: jobs are best-effort background
    // services, and a dead queue must not light up guard actions in the UI.
    registry.registerRouter(
      '/api/ee/guard',
      createGuardRouter({ store: gateStore, enqueueGuardGenerate: jobs.enqueueGuardGenerate }),
    );
    if (jobs.workerStarted) plugin.capabilities.push('guard');

    // A repo-scope spec decision that clears the last conflict (handled by the OSS
    // dashboard spec routes) can unblock a guard generate that had stalled on it.
    // Install the core seam the routes call — same repo→request resolution as the
    // manual Generate router above, keyed by repoKey alone (no HTTP request).
    setGuardGenerateEnqueue(
      createGuardGenerateEnqueue({ store: gateStore, enqueueGuardGenerate: jobs.enqueueGuardGenerate }),
    );

    // The PR analog: a PR-scoped dismissal that clears the PR's last active
    // finding regenerates that PR head's scenarios (honoring the dismissals
    // overlay) through the same durable spec-regen job the PR checkbox uses —
    // with no checkbox comment to settle.
    setGuardPrRegenEnqueue(
      createGuardPrRegenEnqueue({
        store: gateStore,
        octokitFor: (id) => installationOctokit(githubAppConfig, id),
        enqueueGuardSpecRegen: jobs.enqueueGuardSpecRegen,
      }),
    );

    // The same conflict-clearing decision also re-scans the repo baseline so the
    // store corpus re-curates (force — the commit hasn't moved) and the conflict-
    // free scan chains scenario generation. Install the core seam the spec routes
    // call, resolving the repo the same way as the Generate seam above.
    setSpecConflictsResolvedHook(
      createSpecConflictsResolvedBaselineScan({ store: gateStore, enqueueBaseline: jobs.enqueueBaseline }),
    );

    // Repo Knowledge inheritance: a connected repo folds its workspace's Knowledge
    // corpus into its own spec. The spec pipeline materializes the workspace doc
    // bodies + merges the workspace decisions (repo wins) into the checkout before
    // curate/generate through this seam; the repo corpus GET enriches the inherited
    // docs' title/url through the ledger reader seam, and the repo Spec-tab doc route
    // serves an inherited (`knowledge/`) doc's body through the body reader seam
    // (those bodies live in the workspace store, not the repo tree). All resolve the
    // repo's workspace org from the gate store; a repo with no workspace inherits nothing.
    const knowledgeStore = new PgKnowledgeStore(eeDb);
    setSpecInheritanceHook(createSpecInheritanceHook({ store: gateStore, knowledge: knowledgeStore }));
    setKnowledgeLedgerReader(createKnowledgeLedgerReader({ store: gateStore, knowledge: knowledgeStore }));
    setKnowledgeDocBodyReader(createKnowledgeDocBodyReader({ store: gateStore, knowledge: knowledgeStore }));

    // The Spec tab reads source docs (README, ADRs) by repo path. OSS reads the
    // working tree; EE has no checkout, so fetch them from GitHub via the App
    // installation (at the repo's baseline commit). Reuses the gate store above.
    setRepoDocReader((repoKey, docPath, opts) =>
      readRepoDocFromGithub(githubAppConfig, gateStore, repoKey, docPath, opts),
    );

    // The PR-scoped guard tab labels its empty state "queued/running" when a gate
    // is still in flight for the head. Resolve the repo's workspace, then look up
    // the single-flight `guard.gate` job for `(repo, headSha)`. Best-effort — any
    // failure resolves to no pending gate (a plain empty state).
    // The PR Runs picker lists the PR's OWN timeline (one run per pushed head).
    // Core's `readGuardHistoryForPr` resolves the heads through this seam from
    // the gate-run records; OSS leaves it unset (no timeline).
    setGuardGateHeadsLookup(createGuardGateHeadsLookup(gateStore));

    setGuardGatePendingLookup(async (repoKey, headSha) => {
      try {
        const link = await gateStore.getRepo(repoKey);
        if (!link?.workspaceOrgId) return null;
        const job = await jobs.jobStore.getActiveByKey(
          link.workspaceOrgId,
          guardGateJobKey(repoKey, headSha),
        );
        if (!job) return null;
        return { status: job.status === 'running' ? 'running' : 'queued', jobId: job.id };
      } catch (err) {
        log.warn(
          `[ee-server] guard gate pending lookup failed for ${repoKey}@${headSha}: ${(err as Error).message}`,
        );
        return null;
      }
    });

    // LLM providers — the AI-SDK transport (so hosted LLM work doesn't depend on
    // a CLI binary) + the Models settings API. Reuses the validated masterSecret.
    // The trace store is passed as the transport's recorder, so every LLM call
    // the pipeline makes is captured for observability.
    await registerLlmProviders(registry, { db: eeDb, masterSecret, recorder: traceStore });
    plugin.capabilities.push('llm-config');

    // Cross-org Admin console (operator-only): LLM traces + jobs across every
    // workspace. Gated PER-USER on `user.isOperator` (the nav/page hide for
    // members; the routes 403) — NOT a deployment capability, so the feature
    // isn't advertised in the public capabilities list.
    registerAdmin(registry, { db: eeDb, traceStore });
  },
};

export default plugin;
