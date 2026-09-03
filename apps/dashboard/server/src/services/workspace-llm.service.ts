/**
 * The workspace's LLM provider, resolved per run.
 *
 * There is no process-wide transport here. Every step that spends — the
 * onboarding scan, the manual scan, guard generate, analyze's LLM rules, flow
 * enrichment — asks THIS module for the provider of the workspace that
 * triggered it, and threads the resulting driver/transport into the pipeline
 * call. Credentials travel with the run.
 *
 * Two things always happen before a run spends, in this order:
 *   1. LOAD. No stored config ⇒ {@link LlmNotConfiguredError}. Nothing is
 *      started, because there is nothing to start it with.
 *   2. PROBE. One cheap live call proves the credentials, endpoint and model
 *      resolve ⇒ {@link LlmProbeFailedError} carrying the provider's own words.
 *      Once per start, never twice.
 *
 * OPERATOR MODE is the one exception: `TRUECOURSE_LLM_TRANSPORT=claude-code`
 * in the server's environment runs EVERY workspace on the operator's own
 * `claude` login — the self-hosted, single-operator deployment. The store is
 * never consulted, the Models page is read-only, and the probe is the `claude`
 * login check plus the Agent SDK load. Both halves of a run — the agent
 * sessions and the one-shot leaf calls — ride the Agent SDK on that login.
 * Hosted deploys never set it: they keep per-workspace credentials.
 *
 * The store and the backend are seams: boot installs the Postgres store and the
 * real provider calls; tests install their own.
 */

import type { Request } from 'express';
import type { SessionDriver } from '@truecourse/agent-loop';
import { createAppError } from '@truecourse/core/lib/errors';
import type { LlmConfigUpdate, LlmOperatorProvider, LlmProviderConfigView } from '@truecourse/shared';
import type { LlmTransport } from '@truecourse/shared/llm';
import type { GlobalApiLlmConfig, LlmTransportMode } from '@truecourse/core/config/global-config';
import {
  createApiTransportFor,
  createClaudeCodeTransport,
} from '@truecourse/core/services/llm/install-transport';
import {
  createApiSessionDriverFor,
  createClaudeCodeSessionDriver,
  SESSION_MODEL_CLAUDE_CODE,
} from '@truecourse/core/services/llm/session-driver';
import { probeApiConfig, probeClaudeCode } from '@truecourse/core/services/llm/probe';

/**
 * Whether this instance runs on its operator's Claude Code. Read per call so a
 * test can flip it; the env is fixed for the life of a real process.
 */
export function operatorClaudeCode(): boolean {
  return process.env.TRUECOURSE_LLM_TRANSPORT?.trim() === 'claude-code';
}

/** What the Models page shows in operator mode, in place of a stored config. */
export const OPERATOR_PROVIDER: LlmOperatorProvider = {
  provider: 'claude-code',
  model: SESSION_MODEL_CLAUDE_CODE,
};

/** What the Models settings page and the pipeline entries need from storage. */
export interface WorkspaceLlmConfigStore {
  /** Masked, secret-free view for the settings page. Null when unconfigured. */
  getView(orgId: string): Promise<LlmProviderConfigView | null>;
  /** The decrypted block a run builds its transport from. Null when unconfigured. */
  getConfig(orgId: string): Promise<GlobalApiLlmConfig | null>;
  save(orgId: string, input: LlmConfigUpdate): Promise<void>;
}

let store: WorkspaceLlmConfigStore | null = null;

export function setWorkspaceLlmConfigStore(next: WorkspaceLlmConfigStore): void {
  store = next;
}

export function resetWorkspaceLlmConfigStore(): void {
  store = null;
}

/** The installed store. Absent means boot never ran — a bug, not a user error. */
export function workspaceLlmConfigStore(): WorkspaceLlmConfigStore {
  if (!store) throw new Error('No LLM config store installed (boot did not run installDbStores).');
  return store;
}

/**
 * The workspace this request acts in. Every project-scoped route reaches here
 * past the resolver, which already proved this session owns the repository — a
 * session with no workspace could not have got this far, so a missing one is a
 * broken session, not a missing repo.
 */
export function orgOf(req: Request): string {
  const orgId = req.user?.organizationId;
  if (!orgId) throw createAppError('This session has no workspace.', 403);
  return orgId;
}

/** The workspace has no provider set. Nothing has been spent or started. */
export class LlmNotConfiguredError extends Error {
  readonly code = 'llm-not-configured';
  constructor() {
    super(
      'No LLM provider is configured for this workspace. Set one in Settings → Models.',
    );
    this.name = 'LlmNotConfiguredError';
  }
}

/** The stored provider did not answer the pre-flight probe. */
export class LlmProbeFailedError extends Error {
  readonly code = 'llm-probe-failed';
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'LlmProbeFailedError';
  }
}

/** The provider calls themselves — replaced wholesale in tests. */
export interface WorkspaceLlmBackend {
  probe(config: GlobalApiLlmConfig): Promise<void>;
  driver(config: GlobalApiLlmConfig): SessionDriver;
  transport(config: GlobalApiLlmConfig): LlmTransport;
  /** Operator mode: the server's own `claude` login. */
  claudeCode: {
    probe(): Promise<void>;
    driver(): SessionDriver;
    transport(): LlmTransport;
  };
}

const REAL_BACKEND: WorkspaceLlmBackend = {
  probe: (config) => probeApiConfig(config),
  driver: (config) => createApiSessionDriverFor(config).driver,
  // The workspace block names ONE model for every stage, so the per-stage tier
  // hints (Claude CLI aliases, meaningless to a provider API) are not honored.
  transport: (config) => createApiTransportFor(config, { honorRequestModel: false }),
  claudeCode: {
    probe: () => probeClaudeCode(),
    // No cwd: runs happen in ephemeral clones the driver never learns about, so
    // the `claude` subprocess inherits the server's. Fine for a single
    // operator; pass the clone dir if this ever becomes a hosted feature.
    driver: () => createClaudeCodeSessionDriver().driver,
    // The Agent SDK one-shot, on the same login; it honors the per-stage tier
    // aliases exactly as the CLI does.
    transport: () => createClaudeCodeTransport(),
  },
};

let backend: WorkspaceLlmBackend = REAL_BACKEND;

export function setWorkspaceLlmBackend(overrides: Partial<WorkspaceLlmBackend>): void {
  backend = { ...REAL_BACKEND, ...overrides };
}

export function resetWorkspaceLlmBackend(): void {
  backend = REAL_BACKEND;
}

/** A probed provider, ready to run on. Built lazily — a step needs one of the
 *  two, never both. `mode` travels with the transport so the pipeline resolves
 *  stage models for the backend it will really run on. */
export interface WorkspaceLlm {
  mode: LlmTransportMode;
  driver(): SessionDriver;
  transport(): LlmTransport;
}

/**
 * Prove a provider block answers. The settings route runs it against a
 * CANDIDATE that is not stored yet, so a config it accepts is one the pipeline
 * will accept too. Throws the provider's own error.
 */
export function probeWorkspaceLlmConfig(config: GlobalApiLlmConfig): Promise<void> {
  return backend.probe(config);
}

/**
 * The one entry every LLM step starts from: load the asking workspace's
 * provider and prove it answers. Throws {@link LlmNotConfiguredError} or
 * {@link LlmProbeFailedError}; the caller decides what that looks like on its
 * surface (a 409/502, or a failed run record).
 */
export async function startWorkspaceLlm(orgId: string): Promise<WorkspaceLlm> {
  if (operatorClaudeCode()) {
    try {
      await backend.claudeCode.probe();
    } catch (err) {
      throw new LlmProbeFailedError(err);
    }
    return {
      mode: 'claude-code',
      driver: () => backend.claudeCode.driver(),
      transport: () => backend.claudeCode.transport(),
    };
  }
  const config = await workspaceLlmConfigStore().getConfig(orgId);
  if (!config) throw new LlmNotConfiguredError();
  try {
    await backend.probe(config);
  } catch (err) {
    throw new LlmProbeFailedError(err);
  }
  return {
    mode: 'api',
    driver: () => backend.driver(config),
    transport: () => backend.transport(config),
  };
}
