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
 * CREDITS are the other way a run reaches a model: a workspace that names
 * `truecourse` on the Models page stores no key at all and runs on the
 * PLATFORM's own OpenAI key, read from this server's environment
 * (`TRUECOURSE_CREDITS_OPENAI_API_KEY` / `TRUECOURSE_CREDITS_MODEL`), against a
 * granted credit balance. That key is built into a transport here and nowhere
 * else: it is never stored, never answered with — masked or otherwise — and
 * never written onto a run record, whose provider reads `truecourse`. With the
 * environment unset the choice is not offered, and a workspace that had chosen
 * it is told this server holds no credits provider rather than being run on
 * something it did not pick.
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
import {
  LLM_CREDITS_PROVIDER,
  LLM_PROVIDER_KINDS,
  type LlmConfigUpdate,
  type LlmOperatorProvider,
  type LlmProviderChoice,
  type LlmProviderConfigView,
} from '@truecourse/shared';
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
import { meterDriver, type RunMeter, type UsageMeter } from './usage-meter.service.js';
import { openCreditsAccount } from './credits.service.js';
import { isLocalMode } from '../mode.js';

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

/**
 * What a workspace named. `credits` holds nothing of its own: the block a run
 * is built from is the platform's, resolved at start time from the environment.
 */
export type WorkspaceProviderSelection =
  | { kind: 'api'; config: LlmApiConfig }
  | { kind: 'credits' };

/** What the Models settings page and the pipeline entries need from storage. */
export interface WorkspaceLlmConfigStore {
  /** Masked, secret-free view for the settings page. Null when unconfigured. */
  getView(orgId: string): Promise<LlmProviderConfigView | null>;
  /**
   * What this workspace runs on. Null when it has named nothing. A credits
   * workspace answers `{ kind: 'credits' }` — there is no block to hand back,
   * which is the point of it.
   */
  getSelection(orgId: string): Promise<WorkspaceProviderSelection | null>;
  /**
   * The API block it SAVED, or null when it saved none or runs on credits. The
   * settings route builds its candidate from it; the pipeline reads
   * {@link WorkspaceLlmConfigStore.getSelection} instead, because a credits
   * workspace runs on something this answers nothing for.
   */
  getConfig(orgId: string): Promise<LlmApiConfig | null>;
  save(orgId: string, input: LlmConfigUpdate): Promise<void>;
}

/** Whether this workspace spends TrueCourse's credits rather than its own key. */
export async function workspaceOnCredits(orgId: string): Promise<boolean> {
  if (operatorClaudeCode()) return false;
  return (await workspaceLlmConfigStore().getSelection(orgId))?.kind === 'credits';
}

/**
 * The platform's own provider block, read from the environment on every use so
 * it is never held anywhere a dump could find it. Both variables are required:
 * a key with no model would mean guessing which model a workspace's money buys.
 */
export function platformCreditsConfig(): LlmApiConfig | null {
  const apiKey = process.env.TRUECOURSE_CREDITS_OPENAI_API_KEY?.trim();
  const model = process.env.TRUECOURSE_CREDITS_MODEL?.trim();
  if (!apiKey || !model) return null;
  return { provider: 'openai', model, apiKey };
}

/**
 * Whether this server can run a workspace on credits at all. Local mode never
 * can: one developer on one machine has no operator to grant anything, and the
 * whole surface is absent there.
 */
export function creditsOffered(): boolean {
  return !isLocalMode() && !operatorClaudeCode() && platformCreditsConfig() !== null;
}

/** The provider choices this server offers, credits included only when it holds a key. */
export function offeredProviderChoices(): LlmProviderChoice[] {
  return creditsOffered() ? [...LLM_PROVIDER_KINDS, LLM_CREDITS_PROVIDER] : [...LLM_PROVIDER_KINDS];
}

/** The workspace chose credits, and this server holds no platform key to run them on. */
export class CreditsProviderUnavailableError extends Error {
  readonly code = 'credits-provider-unavailable';
  constructor() {
    super(
      'This server has no credits provider configured. Set an API key of your own in Settings → Models.',
    );
    this.name = 'CreditsProviderUnavailableError';
  }
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
  meter: RunMeter | undefined,
  provider: string,
): TransportUsageObserver | undefined {
  if (!meter) return undefined;
  return (usage) =>
    meter.observe({
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
  if (operatorClaudeCode()) {
    try {
      await backend.claudeCode.probe();
    } catch (err) {
      throw new LlmProbeFailedError(err);
    }
    const onUsage = callObserver(meter, OPERATOR_PROVIDER.provider);
    return {
      mode: 'claude-code',
      driver: () => metered(backend.claudeCode.driver(), meter, OPERATOR_PROVIDER.provider),
      transport: () => backend.claudeCode.transport(onUsage),
    };
  }
  const selection = await workspaceLlmConfigStore().getSelection(orgId);
  if (!selection) throw new LlmNotConfiguredError();
  // A credits workspace runs on the platform's block under the platform's NAME:
  // the run record, the usage rows and the Models page all say `truecourse`,
  // because that is what the workspace chose and what its balance pays for.
  const credits = selection.kind === 'credits';
  const config = credits ? platformCreditsConfig() : selection.config;
  if (!config) throw new CreditsProviderUnavailableError();
  if (credits && meter) meter.chargeTo(await openCreditsAccount(orgId));
  try {
    await backend.probe(config);
  } catch (err) {
    throw new LlmProbeFailedError(err);
  }
  const provider = credits ? LLM_CREDITS_PROVIDER : config.provider;
  const onUsage = callObserver(meter, provider);
  return {
    mode: 'api',
    driver: () => metered(backend.driver(config), meter, provider),
    // The gate is in front of the call, never after it: a call that must not be
    // paid for is a call that is not made.
    transport: () => gated(backend.transport(config, onUsage), meter),
  };
}

/** The driver as it is, when nothing is accounting for this run. */
function metered(
  driver: SessionDriver,
  meter: RunMeter | undefined,
  provider: string,
): SessionDriver {
  return meter ? meterDriver(driver, meter, provider) : driver;
}

/** The transport as it is, when nothing is accounting for this run. */
function gated(transport: LlmTransport, meter: RunMeter | undefined): LlmTransport {
  if (!meter) return transport;
  return async (req) => {
    meter.check();
    return transport(req);
  };
}
