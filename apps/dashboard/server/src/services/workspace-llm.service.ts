/**
 * The workspace's LLM provider, resolved per run.
 *
 * There is no process-wide provider here. Every step that spends — the
 * workspace Document scan, guard setup, guard generate and its adjudication,
 * the run's visual judge — asks THIS module for the provider of the workspace
 * that triggered it, and threads the resulting session driver into the pipeline
 * call. Credentials travel with the run.
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
 * login check plus the Agent SDK load. Hosted deploys never set it: they keep
 * per-workspace credentials.
 *
 * The store and the backend are seams: boot installs the Postgres store and the
 * real provider calls; tests install their own.
 */

import type { Request } from 'express';
import type { SessionDriver } from '@truecourse/agent-loop';
import { createAppError } from '@truecourse/core/lib/errors';
import {
  CREDITS_PRICES_UNAVAILABLE,
  CREDITS_PRICES_UNAVAILABLE_MESSAGE,
  LLM_CREDITS_PROVIDER,
  LLM_PROVIDER_KINDS,
  type LlmConfigUpdate,
  type LlmOperatorProvider,
  type LlmProviderChoice,
  type LlmProviderConfigView,
} from '@truecourse/shared';
import type { LlmApiConfig, LlmTransportMode } from '@truecourse/core/services/llm/provider-config';
import {
  createApiSessionDriverFor,
  createClaudeCodeSessionDriver,
} from '@truecourse/core/services/llm/session-driver';
import { resolveModel } from '@truecourse/core/config/llm-models';
import { probeApiConfig, probeClaudeCode } from '@truecourse/core/services/llm/probe';
import { getModelPrices } from '@truecourse/core/services/llm/model-prices';
import { priceOfConfig } from '@truecourse/core/services/llm/provider';
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

/** The provider name every operator-mode run is recorded under. */
const OPERATOR_PROVIDER_NAME = 'claude-code';

/** What the Models page shows in operator mode, in place of a stored config:
 *  the one model this process's `claude` login runs everything on. */
export function operatorProvider(): LlmOperatorProvider {
  return { provider: OPERATOR_PROVIDER_NAME, model: resolveModel() };
}

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
 * it is never held anywhere a dump could find it. The key and the model are
 * required: a key with no model would mean guessing which model a workspace's
 * money buys. Two optional variables say where that model lives and what it
 * costs, for a key that is not OpenAI's own:
 *   - `TRUECOURSE_CREDITS_OPENAI_BASE_URL` points the OpenAI client at an
 *     OpenAI-compatible endpoint (an Azure AI Foundry resource's `/openai/v1`),
 *     which takes the same key as the bearer token the client already sends.
 *   - `TRUECOURSE_CREDITS_PRICE_MODEL` is the list-price model the deployment
 *     named by `TRUECOURSE_CREDITS_MODEL` serves. Without it a deployment name
 *     has no price, and a credits run is refused at start rather than run
 *     without a debit.
 */
export function platformCreditsConfig(): LlmApiConfig | null {
  const apiKey = process.env.TRUECOURSE_CREDITS_OPENAI_API_KEY?.trim();
  const model = process.env.TRUECOURSE_CREDITS_MODEL?.trim();
  if (!apiKey || !model) return null;
  const baseURL = process.env.TRUECOURSE_CREDITS_OPENAI_BASE_URL?.trim();
  const priceModel = process.env.TRUECOURSE_CREDITS_PRICE_MODEL?.trim();
  return {
    provider: 'openai',
    model,
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(priceModel ? { priceModel } : {}),
  };
}

/**
 * The model a credits run's calls are charged as: the deployment's list-price
 * model when the environment names one, else the model itself. Null when this
 * server holds no credits provider.
 */
export function creditsPriceModel(): string | null {
  const config = platformCreditsConfig();
  return config ? config.priceModel || config.model : null;
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

/**
 * The workspace spends credits and its model has no price — no price table has
 * been fetched yet, or the table holds none for the model the platform's calls
 * are charged as. A run that cannot be priced cannot be charged, so it does not
 * start.
 */
export class CreditsPricesUnavailableError extends Error {
  readonly code = CREDITS_PRICES_UNAVAILABLE;
  constructor() {
    super(CREDITS_PRICES_UNAVAILABLE_MESSAGE);
    this.name = 'CreditsPricesUnavailableError';
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
  /** Operator mode: the server's own `claude` login. */
  claudeCode: {
    probe(): Promise<void>;
    driver(): SessionDriver;
  };
}

const REAL_BACKEND: WorkspaceLlmBackend = {
  probe: (config) => probeApiConfig(config),
  driver: (config) => createApiSessionDriverFor(config).driver,
  claudeCode: {
    probe: () => probeClaudeCode(),
    // No cwd: runs happen in ephemeral clones the driver never learns about, so
    // the `claude` subprocess inherits the server's. Fine for a single
    // operator; pass the clone dir if this ever becomes a hosted feature.
    driver: () => createClaudeCodeSessionDriver().driver,
  },
};

let backend: WorkspaceLlmBackend = REAL_BACKEND;

export function setWorkspaceLlmBackend(overrides: Partial<WorkspaceLlmBackend>): void {
  backend = { ...REAL_BACKEND, ...overrides };
}

export function resetWorkspaceLlmBackend(): void {
  backend = REAL_BACKEND;
}

/** A probed provider, ready to run on. The driver is built lazily — a fully
 *  cached step never asks for one. `mode` travels with it so a run record says
 *  which backend it really ran on. */
export interface WorkspaceLlm {
  mode: LlmTransportMode;
  driver(): SessionDriver;
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
 * The one entry every LLM step starts from: load the asking workspace's
 * provider and prove it answers. Throws {@link LlmNotConfiguredError} or
 * {@link LlmProbeFailedError}; the caller decides what that looks like on its
 * surface (a 409/502, or a failed run record). A credits workspace whose model
 * cannot be priced throws {@link CreditsPricesUnavailableError} before
 * anything is probed: this is the gate every metered job starts through, the
 * ones a route never saw (a chained setup → generate → run, the ripple, a
 * resumed pause) included.
 *
 * A workspace on its own key is not gated on prices: its turns are recorded
 * unpriced until a table has been fetched. The fetch is started here so the
 * run's first turns can already be priced.
 *
 * A job that must account for what it spends passes its METER: the driver is
 * wrapped so every turn of every session is counted, which is every LLM call
 * the run makes. The pre-flight probe itself is one tiny unmetered call — it
 * runs before any of this exists, which is what makes it a probe.
 */
export async function startWorkspaceLlm(orgId: string, meter?: UsageMeter): Promise<WorkspaceLlm> {
  if (operatorClaudeCode()) {
    try {
      await backend.claudeCode.probe();
    } catch (err) {
      throw new LlmProbeFailedError(err);
    }
    return {
      mode: 'claude-code',
      driver: () => metered(backend.claudeCode.driver(), meter, OPERATOR_PROVIDER_NAME),
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
  if (credits) {
    if (!(await priceOfConfig(config))) throw new CreditsPricesUnavailableError();
    if (meter) meter.chargeTo(await openCreditsAccount(orgId));
  } else {
    void getModelPrices();
  }
  try {
    await backend.probe(config);
  } catch (err) {
    throw new LlmProbeFailedError(err);
  }
  const provider = credits ? LLM_CREDITS_PROVIDER : config.provider;
  return {
    mode: 'api',
    driver: () => metered(backend.driver(config), meter, provider),
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

