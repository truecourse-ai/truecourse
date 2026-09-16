/**
 * The workspace's LLM provider, resolved per run.
 *
 * There is no process-wide transport here. Every step that spends — the
 * workspace Document scan, guard setup, guard generate and its adjudication,
 * the run's visual judge — asks THIS module for the provider of the workspace
 * that triggered it, and threads the resulting driver/transport into the
 * pipeline call. Credentials travel with the run.
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
import type { LlmTransport, TransportUsageObserver } from '@truecourse/shared/llm';
import type { LlmApiConfig, LlmTransportMode } from '@truecourse/core/services/llm/provider-config';
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
import { meterDriver, type RunUsageObserver, type UsageMeter } from './usage-meter.service.js';

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
  getConfig(orgId: string): Promise<LlmApiConfig | null>;
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
  probe(config: LlmApiConfig): Promise<void>;
  driver(config: LlmApiConfig): SessionDriver;
  /** `onUsage` is threaded in at construction: a transport answers with text,
   *  so there is nothing to read a call's spend off from outside. */
  transport(config: LlmApiConfig, onUsage?: TransportUsageObserver): LlmTransport;
  /** Operator mode: the server's own `claude` login. */
  claudeCode: {
    probe(): Promise<void>;
    driver(): SessionDriver;
    transport(onUsage?: TransportUsageObserver): LlmTransport;
  };
}

const REAL_BACKEND: WorkspaceLlmBackend = {
  probe: (config) => probeApiConfig(config),
  driver: (config) => createApiSessionDriverFor(config).driver,
  // The workspace block names ONE model for every stage, so the per-stage tier
  // hints (Claude CLI aliases, meaningless to a provider API) are not honored.
  transport: (config, onUsage) =>
    createApiTransportFor(config, {
      honorRequestModel: false,
      ...(onUsage ? { onUsage } : {}),
    }),
  claudeCode: {
    probe: () => probeClaudeCode(),
    // No cwd: runs happen in ephemeral clones the driver never learns about, so
    // the `claude` subprocess inherits the server's. Fine for a single
    // operator; pass the clone dir if this ever becomes a hosted feature.
    driver: () => createClaudeCodeSessionDriver().driver,
    // The Agent SDK one-shot, on the same login; it honors the per-stage tier
    // aliases exactly as the CLI does.
    transport: (onUsage) => createClaudeCodeTransport(onUsage),
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
export function probeWorkspaceLlmConfig(config: LlmApiConfig): Promise<void> {
  return backend.probe(config);
}

/**
 * How a one-shot call's spend reaches the meter: the transport reports the
 * stage, the tokens and the cost, and the PROVIDER is added here, by whoever
 * chose it.
 */
function callObserver(
  observe: RunUsageObserver | undefined,
  provider: string,
): TransportUsageObserver | undefined {
  if (!observe) return undefined;
  return (usage) =>
    observe({
      subjectKind: 'stage',
      subject: usage.stage,
      provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreateTokens: usage.cacheCreateTokens,
      costUsd: usage.costUsd,
    });
}

/**
 * The one entry every LLM step starts from: load the asking workspace's
 * provider and prove it answers. Throws {@link LlmNotConfiguredError} or
 * {@link LlmProbeFailedError}; the caller decides what that looks like on its
 * surface (a 409/502, or a failed run record).
 *
 * A job that must account for what it spends passes its METER, and both halves
 * of the run it gets back report into it: the transport is built with the
 * observer, and the driver is wrapped so every turn of every session is counted.
 * The pre-flight probe itself is one tiny unmetered call — it runs before any
 * of this exists, which is what makes it a probe.
 */
export async function startWorkspaceLlm(orgId: string, meter?: UsageMeter): Promise<WorkspaceLlm> {
  const observe = meter?.observe;
  if (operatorClaudeCode()) {
    try {
      await backend.claudeCode.probe();
    } catch (err) {
      throw new LlmProbeFailedError(err);
    }
    const onUsage = callObserver(observe, OPERATOR_PROVIDER.provider);
    return {
      mode: 'claude-code',
      driver: () => metered(backend.claudeCode.driver(), observe),
      transport: () => backend.claudeCode.transport(onUsage),
    };
  }
  const config = await workspaceLlmConfigStore().getConfig(orgId);
  if (!config) throw new LlmNotConfiguredError();
  try {
    await backend.probe(config);
  } catch (err) {
    throw new LlmProbeFailedError(err);
  }
  const onUsage = callObserver(observe, config.provider);
  return {
    mode: 'api',
    driver: () => metered(backend.driver(config), observe),
    transport: () => backend.transport(config, onUsage),
  };
}

/** The driver as it is, when nothing is accounting for this run. */
function metered(driver: SessionDriver, observe: RunUsageObserver | undefined): SessionDriver {
  return observe ? meterDriver(driver, observe) : driver;
}
