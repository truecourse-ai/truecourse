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
import { loadWorkosConfig } from './config.js';
import { createAuthRouter, createSessionVerifier } from './auth.js';
import { createWorkspaceRouter } from './workspace.js';

const plugin: EePlugin = {
  capabilities: ['sso', 'workspace'],
  register(registry) {
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
  },
};

export default plugin;
