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
import { createEeDb, type EeDb } from '@truecourse/ee-db';
import { WorkspaceSettingsStore } from '@truecourse/ee-data-store';
import { log } from '@truecourse/core/lib/logger';
import { registerGithubApp, selectGateStore, loadGithubAppConfig } from '@truecourse/ee-github-app';
import { loadWorkosConfig } from './config.js';
import { createAuthRouter, createSessionVerifier } from './auth.js';
import { createWorkspaceRouter } from './workspace.js';
import { registerLlmProviders } from './llm/index.js';
import { registerKnowledge } from './knowledge/index.js';
import { registerIntegrations } from './integrations/index.js';
import { registerJobs } from './jobs/index.js';
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

    // Throws if WorkOS env is incomplete; the OSS loader catches it and
    // falls back to community rather than running half-authenticated.
    const cfg = loadWorkosConfig();
    const workos = new WorkOS(cfg.apiKey, { clientId: cfg.clientId });

    // Auth endpoints must be reachable without a session.
    registry.registerRouter('/api/ee/auth', createAuthRouter(workos, cfg), {
      public: true,
    });

    // The gate uses this to protect every other route in enterprise mode.
    registry.setAuthVerifier(createSessionVerifier(workos, cfg));

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
    if (!loadGithubAppConfig()) {
      throw new Error(
        '[ee-server] GitHub App is required: the enterprise edition gates pull requests through a GitHub App (there is no SSO-only mode). Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_WEBHOOK_SECRET, and GITHUB_APP_SLUG.',
      );
    }

    const handle = await createEeDb(databaseUrl);
    const eeDb: EeDb = handle.db;
    log.info('[ee-server] ee-db ready (Postgres, migrations applied)');
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
    // queue API the Knowledge router enqueues sync jobs onto. Started before
    // Knowledge so its `/sync` route has the queue; jobs only run on demand, by
    // which point the LLM transport (below) is installed.
    const jobs = await registerJobs(registry, { db: eeDb, masterSecret, connectionString: databaseUrl });
    plugin.capabilities.push('jobs');

    // Workspace Knowledge (Spec/Contracts/Decisions reads + connector sync) and
    // Settings → Integrations (encrypted connector tokens). Both need the
    // Postgres stores installed above + the master secret.
    registerKnowledge(registry, { db: eeDb, masterSecret, jobs });
    registerIntegrations(registry, { db: eeDb, masterSecret });
    plugin.capabilities.push('knowledge');

    // GitHub App PR gate — required (env validated at boot above, so this always
    // lights up `github-gate`). The repo scan (connect + push) runs on the
    // background job queue via enqueueBaseline.
    await registerGithubApp(registry, {
      appUrl: cfg.appUrl,
      db: eeDb,
      enqueueBaseline: jobs.enqueueBaseline,
      codeAnalysisLlm: (org) => new WorkspaceSettingsStore(eeDb).codeAnalysisLlm(org),
    });
    plugin.capabilities.push('github-gate');

    // LLM providers — the AI-SDK transport (so hosted LLM work doesn't depend on
    // a CLI binary) + the Models settings API. Reuses the validated masterSecret.
    // The trace store is passed as the transport's recorder, so every LLM call
    // the pipeline makes is captured for observability.
    await registerLlmProviders(registry, { db: eeDb, masterSecret, recorder: traceStore });
    plugin.capabilities.push('llm-config');

    // Cross-org Admin console (operator-only): LLM traces + jobs across every
    // workspace. Gated PER-USER on `eeUser.isOperator` (the nav/page hide for
    // members; the routes 403) — NOT a deployment capability, so the feature
    // isn't advertised in the public capabilities list.
    registerAdmin(registry, { db: eeDb, traceStore });
  },
};

export default plugin;
