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
import { log } from '@truecourse/core/lib/logger';
import { registerGithubApp } from '@truecourse/ee-github-app';
import { loadWorkosConfig } from './config.js';
import { createAuthRouter, createSessionVerifier } from './auth.js';
import { createWorkspaceRouter } from './workspace.js';
import { registerLlmProviders } from './llm/index.js';
import { installEeStores, sweepStaleTempDirs } from './storage.js';

const plugin: EePlugin = {
  capabilities: ['sso', 'workspace'],
  async register(registry) {
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

    // Workspace data (SSO status + members) — protected, behind the gate.
    registry.registerRouter('/api/ee/workspace', createWorkspaceRouter(workos));

    // One shared Postgres connection + migration history for all ee features
    // (gate, LLM config, and later analysis/drift). Null in deploys without a DB.
    const databaseUrl = process.env.DATABASE_URL ?? null;
    let eeDb: EeDb | null = null;
    if (databaseUrl) {
      const handle = await createEeDb(databaseUrl);
      eeDb = handle.db;
      log.info('[ee-server] ee-db ready (Postgres, migrations applied)');
      // Switch the whole pipeline to server-side storage (Postgres + Blob) so
      // nothing reads/writes the customer's `.truecourse/` tree. Then mop up any
      // temp dirs a previous run's crash leaked.
      installEeStores(handle);
      sweepStaleTempDirs();
    }

    // GitHub App PR gate — optional. Lights up `github-gate` only when the
    // GITHUB_APP_* env is present, so SSO-only deploys are unaffected.
    const githubEnabled = await registerGithubApp(registry, {
      appUrl: cfg.appUrl,
      db: eeDb,
    });
    if (githubEnabled) plugin.capabilities.push('github-gate');

    // LLM providers — installs the AI-SDK transport (so hosted LLM work doesn't
    // depend on a CLI binary) and the Models settings API. Lights up only when
    // the encrypted Postgres store is available.
    const llmEnabled = await registerLlmProviders(registry, {
      db: eeDb,
      masterSecret: process.env.TRUECOURSE_SECRET_KEY ?? null,
    });
    if (llmEnabled) plugin.capabilities.push('llm-config');
  },
};

export default plugin;
