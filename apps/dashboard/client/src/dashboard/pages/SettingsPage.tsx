/**
 * Settings as a hub: the workspace's members, where its repositories are
 * connected from, the LLM provider, and whatever this edition registered
 * beside them. The sub-tab is in the URL, so a settings page is a place a link
 * can point at.
 *
 * Everything here is the server's. There is no plan and no entitlement read yet,
 * so nothing is drawn as plan-gated: a feature that is not built says Coming
 * soon, which is what it is, rather than wearing a lock that would claim a plan
 * decides it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  GITHUB_CONNECT_OUTCOMES,
  GITHUB_INSTALL_ORIGINS,
  LLM_PROVIDER_KINDS,
} from '@truecourse/shared';
import type {
  GithubConnectOutcome,
  GithubInstallationSummary,
  GithubRepoSummary,
  LlmConfigResponse,
  LlmConfigUpdate,
  LlmProviderKind,
  GithubInstallOrigin,
  LocalRepositorySummary,
} from '@truecourse/shared';
import { StatusWord } from '@/dashboard/ui/status-word';
import { Facts, ProviderIcon, PageHeader, SideMenu } from '@/dashboard/ui/bits';
import { fetchLlmConfig, saveLlmConfig } from '@/dashboard/data/llm-config';
import { offeredRepositoryProviders } from '@/dashboard/data/providers';
import {
  attachGithubInstallations,
  detachGithubInstallation,
  fetchGithubStatus,
  installationSettingsUrl,
} from '@/dashboard/data/real-repos';
import { fetchLocalRepos } from '@/dashboard/providers/local-folder';
import { useServerMode } from '@/contexts/CapabilityContext';
import { MembersTab, type InviteKind } from '@/dashboard/pages/MembersTab';
import { useDashboardState } from '@/dashboard/shell/dashboard-state';
import { registeredSettingsTabs, type SettingsTab } from '@/dashboard/shell/registry';

/** What '/api/github/status' said; null while the read is in flight. */
type GithubProviderState = {
  installations: GithubInstallationSummary[];
  /**
   * Connect: authorize with GitHub, which attaches the installations this
   * person can reach, or sends them on to install. Absent on a server that
   * has no App configured.
   */
  connectUrl: string | null;
  /** The App's install page, for an account that does not have it yet. */
  installUrl: string | null;
  /** The repositories linked to this workspace, per installation. */
  linked: GithubRepoSummary[];
  /**
   * What a `pick` landing's offer names, when the server still honours it;
   * null when it does not (expired, or another session's).
   */
  offered: GithubInstallationSummary[] | null;
  /** Why the read failed, when it did. */
  reason?: string;
};

/**
 * Where a trip that started elsewhere continues once its pick is made. The
 * same table the server lands a trip that attached on; a pick lands here
 * first because the choice is made here.
 */
const RETURN_TO: Record<GithubInstallOrigin, string> = {
  settings: '/settings/repositories',
  'code-connect': '/code?connect=1',
  'context-add': '/context?add=repository',
};

/** What each outcome says. `pick` draws the offer instead of a line. */
const OUTCOME_NOTE: Record<Exclude<GithubConnectOutcome, 'pick'>, string> = {
  'nothing-new':
    'Every GitHub account you can reach is connected here already. Install on another account to add one.',
  requested:
    "Your request to install the App was sent to the account's owners. Connect again once they approve it.",
  none: 'The App is installed on no GitHub account you can reach. Nothing was added.',
  expired:
    'The trip to GitHub took too long, or came back to another session. Nothing was added. Try again.',
  denied: 'GitHub did not complete the authorization. Nothing was added. Try again.',
  unreachable: 'GitHub did not confirm your access to that installation. Nothing was added.',
  updated: 'Repository access updated on GitHub.',
};

/** The outcomes that are news, not a refusal: drawn quietly. */
const QUIET_OUTCOMES: ReadonlySet<GithubConnectOutcome> = new Set(['updated', 'nothing-new', 'requested']);

function outcomeOf(raw: string | null): GithubConnectOutcome | null {
  return raw && (GITHUB_CONNECT_OUTCOMES as readonly string[]).includes(raw)
    ? (raw as GithubConnectOutcome)
    : null;
}

/**
 * Repositories: where they are connected FROM. One row per source-control
 * provider — its mark, its name, a status word, and the accounts under it,
 * one line each.
 *
 * GitHub is the real one: its accounts are the App's installations the server
 * reports, each line naming the account, its type and how many repositories
 * this workspace has linked through it, and connecting is a top-level
 * navigation to GitHub's authorize page. An install comes back attached; a
 * plain authorize comes back HERE with the accounts the person can reach and
 * this workspace does not hold, offered for them to pick, since nothing is
 * attached without a choice. Every trip that did not attach lands here too,
 * saying how it ended, wherever it started. On a local server the folders of this
 * machine are real too, each line naming the repository and the path behind it,
 * and connecting one is the connect dialog, where the path is typed. Every
 * other provider is listed and says Coming soon: hiding one would make the page
 * lie about where this is going, and offering it would make it lie about what
 * it does.
 */
/** Where an install started here returns to: the place that sent the user here, else this tab. */
function installOriginOf(raw: string | null): GithubInstallOrigin {
  return raw && (GITHUB_INSTALL_ORIGINS as readonly string[]).includes(raw)
    ? (raw as GithubInstallOrigin)
    : 'settings';
}

function RepositoriesTab() {
  const mode = useServerMode();
  const navigate = useNavigate();
  const { refreshRealRepos } = useDashboardState();
  const [github, setGithub] = useState<GithubProviderState | null>(null);
  const [folders, setFolders] = useState<LocalRepositorySummary[] | null>(null);
  const [detaching, setDetaching] = useState<number | null>(null);
  const [params, setParams] = useSearchParams();
  const from = installOriginOf(params.get('from'));
  // A trip to GitHub that did not attach lands here saying how it ended; a
  // `pick` carries the offer of accounts the person can choose from.
  const outcome = outcomeOf(params.get('github'));
  const offer = outcome === 'pick' ? params.get('offer') : null;
  /** The offered accounts still ticked; null until the person touches one, meaning all of them. */
  const [picked, setPicked] = useState<number[] | null>(null);
  const [attaching, setAttaching] = useState(false);

  // Reads race: a slower earlier read (another `from`, or the effect's read
  // overlapping a detach's) must not overwrite a newer answer, nor land after
  // the tab is gone. Only the latest read applies.
  const readSeq = useRef(0);
  const readGithub = useCallback(async () => {
    const seq = ++readSeq.current;
    const apply = (next: GithubProviderState) => {
      if (seq === readSeq.current) setGithub(next);
    };
    try {
      const status = await fetchGithubStatus(from, offer ?? undefined);
      apply({
        installations: status.installations,
        connectUrl: status.connectUrl || null,
        installUrl: status.installUrl || null,
        linked: status.repos,
        offered: status.offered ?? null,
      });
    } catch (error: unknown) {
      apply({
        installations: [],
        connectUrl: null,
        installUrl: null,
        linked: [],
        offered: null,
        reason: error instanceof Error ? error.message : 'GitHub could not be reached',
      });
    }
  }, [from, offer]);

  useEffect(() => {
    void readGithub();
    return () => {
      readSeq.current += 1;
    };
  }, [readGithub]);

  const chosen = picked ?? (github?.offered ?? []).map((i) => i.installationId);
  const togglePick = (installationId: number, on: boolean) =>
    setPicked(on ? [...new Set([...chosen, installationId])] : chosen.filter((id) => id !== installationId));

  // The pick: attach what is ticked, then carry on where the trip started —
  // or, for a trip started here, drop the landing's flags and read afresh.
  const attachPicked = async () => {
    if (!offer || chosen.length === 0) return;
    setAttaching(true);
    try {
      await attachGithubInstallations({ offer, installationIds: chosen });
      if (from !== 'settings') {
        navigate(RETURN_TO[from]);
        return;
      }
      setPicked(null);
      setParams(new URLSearchParams(), { replace: true });
    } catch (error: unknown) {
      setGithub((prev) =>
        prev
          ? { ...prev, reason: error instanceof Error ? error.message : 'Could not connect the accounts' }
          : prev,
      );
    } finally {
      setAttaching(false);
    }
  };

  // Detach an installation from this workspace: the repositories connected
  // through it here go with it, so the person is told how many before it does.
  // A detach the server could only half do is re-read either way, so the page
  // shows what is actually left and the reason beside it.
  const detach = useCallback(
    async (installation: GithubInstallationSummary) => {
      const linked = (github?.linked ?? []).filter(
        (r) => r.installationId === installation.installationId,
      );
      const name = installation.accountLogin || `#${installation.installationId}`;
      const repos =
        linked.length === 0
          ? ''
          : ` ${linked.length} repositor${linked.length === 1 ? 'y' : 'ies'} connected through it will be disconnected: ${linked
              .map((r) => r.repoFullName)
              .join(', ')}.`;
      const warning = `Remove ${name} from this workspace?${repos} Context sources that read through it will stop syncing until it is connected again.`;
      if (!window.confirm(warning)) return;
      setDetaching(installation.installationId);
      let failure: string | null = null;
      try {
        await detachGithubInstallation(installation.installationId);
      } catch (error: unknown) {
        failure = error instanceof Error ? error.message : 'Could not remove the account';
      }
      await Promise.all([readGithub(), refreshRealRepos()]);
      if (failure) {
        const reason = failure;
        setGithub((prev) => (prev ? { ...prev, reason } : prev));
      }
      setDetaching(null);
    },
    [github, readGithub, refreshRealRepos],
  );

  // The folders this machine has connected. Only a local server has any, and
  // only a local server has the route to ask.
  useEffect(() => {
    if (mode !== 'local') return;
    let live = true;
    void fetchLocalRepos()
      .then((connected) => {
        if (live) setFolders(connected);
      })
      .catch(() => {
        if (live) setFolders([]);
      });
    return () => {
      live = false;
    };
  }, [mode]);

  const installations = github?.installations ?? [];

  return (
    <ul className="divide-y divide-border border-b border-border" aria-label="Providers">
      {offeredRepositoryProviders(mode).map((provider) => {
        const { id, name } = provider;
        const isGithub = id === 'github';
        const isLocal = id === 'local';
        const live = isGithub || isLocal;
        const connected = isGithub ? installations.length > 0 : (folders ?? []).length > 0;
        const reading = isGithub ? github === null : folders === null;
        return (
          <li key={id} className="flex items-start gap-4 px-6 py-3">
            <ProviderIcon provider={id} className="mt-0.5 h-6 w-6 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-medium text-foreground">{name}</span>
                {!live && <span className="text-[11px] text-muted-foreground">Coming soon</span>}
                {live && reading && <StatusWord tone="neutral" word="Reading" />}
                {live && !reading && (
                  <StatusWord
                    tone={connected ? 'success' : 'neutral'}
                    word={connected ? 'Connected' : 'Not connected'}
                  />
                )}
              </div>
              {isGithub && github?.reason && (
                <p className="mt-1 text-[11px] text-destructive">{github.reason}</p>
              )}
              {isGithub && outcome && outcome !== 'pick' && (
                <p
                  className={`mt-1 text-[11px] ${
                    QUIET_OUTCOMES.has(outcome) ? 'text-muted-foreground' : 'text-destructive'
                  }`}
                >
                  {OUTCOME_NOTE[outcome]}
                </p>
              )}
              {isGithub && outcome === 'pick' && github && (
                github.offered && github.offered.length > 0 ? (
                  <div className="mt-1">
                    <p className="text-[11px] text-muted-foreground">
                      GitHub named {github.offered.length} account
                      {github.offered.length === 1 ? '' : 's'} this workspace does not hold. Pick the ones to connect.
                    </p>
                    <ul className="mt-1 space-y-1" aria-label="Offered GitHub accounts">
                      {github.offered.map((i) => {
                        const name = i.accountLogin || `#${i.installationId}`;
                        return (
                          <li key={i.installationId}>
                            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={chosen.includes(i.installationId)}
                                onChange={(e) => togglePick(i.installationId, e.target.checked)}
                                disabled={attaching}
                              />
                              <span className="text-foreground">{name}</span>
                              {i.accountType ? ` · ${i.accountType.toLowerCase()}` : ''}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      onClick={() => void attachPicked()}
                      disabled={attaching || chosen.length === 0}
                      className="mt-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {attaching ? 'Connecting' : 'Connect selected'}
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] text-destructive">
                    That offer expired. Connect again to get a fresh one.
                  </p>
                )
              )}
              {isGithub && installations.length > 0 && (
                <ul className="mt-1 space-y-1" aria-label="GitHub installations">
                  {installations.map((i) => {
                    const linked = (github?.linked ?? []).filter(
                      (r) => r.installationId === i.installationId,
                    ).length;
                    const name = i.accountLogin || `#${i.installationId}`;
                    return (
                      <li key={i.installationId} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="min-w-0 truncate">
                          <span className="text-foreground">{name}</span>
                          {i.accountType ? ` · ${i.accountType.toLowerCase()}` : ''} ·{' '}
                          {linked} repositor{linked === 1 ? 'y' : 'ies'} linked
                        </span>
                        {/* Which repositories the App can see is GitHub's
                            setting, on the installation's own page there. */}
                        <a
                          href={installationSettingsUrl(i)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Manage ${name} on GitHub`}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          Manage on GitHub
                        </a>
                        <button
                          type="button"
                          onClick={() => void detach(i)}
                          disabled={detaching !== null}
                          aria-label={`Remove ${name}`}
                          className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          {detaching === i.installationId ? 'Removing' : 'Remove'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {isGithub && installations.length > 0 && github?.installUrl && (
                <a
                  href={github.installUrl}
                  className="mt-1 inline-block text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Install on another GitHub account
                </a>
              )}
              {isLocal && (folders ?? []).length > 0 && (
                <ul className="mt-1 space-y-1" aria-label="Connected folders">
                  {(folders ?? []).map((folder) => (
                    <li key={folder.repoFullName} className="truncate text-[11px] text-muted-foreground">
                      <span className="text-foreground">{folder.repoFullName}</span> · {folder.path}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {isGithub && github?.connectUrl && (
              <a
                href={github.connectUrl}
                className={`shrink-0 rounded px-2.5 py-1.5 text-xs font-medium ${
                  installations.length === 0
                    ? 'bg-primary text-primary-foreground hover:opacity-90'
                    : 'border border-border text-foreground hover:bg-muted/60'
                }`}
              >
                {installations.length === 0 ? 'Connect' : 'Add account'}
              </a>
            )}
            {isLocal && (
              <Link
                to={'/code?connect=1'}
                className={`shrink-0 rounded px-2.5 py-1.5 text-xs font-medium ${
                  connected
                    ? 'border border-border text-foreground hover:bg-muted/60'
                    : 'bg-primary text-primary-foreground hover:opacity-90'
                }`}
              >
                {connected ? 'Add folder' : 'Connect'}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const PROVIDER_LABEL: Record<LlmProviderKind, string> = {
  anthropic: 'Anthropic API',
  openai: 'OpenAI',
  bedrock: 'AWS Bedrock',
  copilot: 'GitHub Copilot',
};

const MODEL_PLACEHOLDER: Record<LlmProviderKind, string> = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-5.6',
  bedrock: 'anthropic.claude-opus-5',
  copilot: 'gpt-5.6',
};

const FIELD =
  'mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
const FIELD_MONO = `${FIELD} font-mono`;

/**
 * The workspace's LLM provider, for real. Saving is a live provider TEST: the
 * server probes the candidate before it stores anything, so a refusal comes
 * back in the provider's own words and is shown as it arrived — the whole
 * point of the button is to find out what the provider says.
 *
 * The stored key never comes back, only its masked tail, so an empty key field
 * means "keep the one you have" (same provider only — switching needs a key).
 */
function ModelsTab() {
  const { refreshLlmProvider } = useDashboardState();
  const [data, setData] = useState<LlmConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [provider, setProvider] = useState<LlmProviderKind>('anthropic');
  const [model, setModel] = useState('');
  const [fallbackModel, setFallbackModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [region, setRegion] = useState('');

  const apply = useCallback((next: LlmConfigResponse) => {
    setData(next);
    if (!next.config) return;
    setProvider(next.config.provider);
    setModel(next.config.model);
    setFallbackModel(next.config.fallbackModel ?? '');
    setAccessKeyId(next.config.accessKeyId ?? '');
    setBaseURL(next.config.baseURL ?? '');
    setRegion(next.config.region ?? '');
  }, []);

  useEffect(() => {
    let live = true;
    void fetchLlmConfig()
      .then((next) => {
        if (live) apply(next);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [apply]);

  // An instance on its operator's Claude Code: the form would save a provider
  // no run ever reads, so there is none — only what the runs use.
  if (data?.operator) {
    return (
      <Facts
        className="border-b border-border"
        rowClassName="px-6"
        rows={[
          { label: 'Provider', value: 'Claude Code (operator)' },
          { label: 'Model', value: <span className="font-mono">{data.operator.model}</span> },
          { label: 'Set by', value: <span className="font-mono">TRUECOURSE_LLM_TRANSPORT=claude-code</span> },
        ]}
      />
    );
  }

  const current = data?.config ?? null;
  const isBedrock = provider === 'bedrock';
  const keyIsForThisProvider = current?.hasKey && current.provider === provider;
  const keyPlaceholder = keyIsForThisProvider
    ? `${current?.keyMask ?? '••••'}, leave blank to keep`
    : isBedrock
      ? 'AWS secret access key, or blank to use the IAM role'
      : 'Paste the provider API key';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const update: LlmConfigUpdate = {
      provider,
      model: model.trim(),
      ...(fallbackModel.trim() ? { fallbackModel: fallbackModel.trim() } : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(accessKeyId.trim() ? { accessKeyId: accessKeyId.trim() } : {}),
      ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
      ...(region.trim() ? { region: region.trim() } : {}),
    };
    void saveLlmConfig(update)
      .then((next) => {
        apply(next);
        setApiKey('');
        setSaved(true);
        // The shell's needs-setup surfaces answer to this read, not to the form.
        return refreshLlmProvider();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      {current && (
        <Facts
          className="border-b border-border"
          rowClassName="px-6"
          rows={[
            { label: 'Provider', value: PROVIDER_LABEL[current.provider] },
            { label: 'Model', value: <span className="font-mono">{current.model}</span> },
            { label: 'Key', value: current.hasKey ? (current.keyMask ?? 'stored') : 'no stored key' },
            { label: 'Updated', value: new Date(current.updatedAt).toLocaleString() },
          ]}
        />
      )}

        <form onSubmit={submit} className="max-w-xl space-y-2 px-6 py-5">
          <label className="block text-[11px] font-medium text-muted-foreground">
            Provider
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as LlmProviderKind)}
              className={FIELD}
            >
              {(data?.providers ?? LLM_PROVIDER_KINDS).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[11px] font-medium text-muted-foreground">
            Model
            <input
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={MODEL_PLACEHOLDER[provider]}
              className={FIELD_MONO}
            />
          </label>

          <label className="block text-[11px] font-medium text-muted-foreground">
            Fallback model
            <input
              value={fallbackModel}
              onChange={(e) => setFallbackModel(e.target.value)}
              placeholder="Tried only if the primary model errors"
              className={FIELD_MONO}
            />
          </label>

          <label className="block text-[11px] font-medium text-muted-foreground">
            {isBedrock ? 'AWS secret access key' : 'API key'}
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyPlaceholder}
              className={FIELD_MONO}
            />
          </label>

          {isBedrock ? (
            <>
              <label className="block text-[11px] font-medium text-muted-foreground">
                AWS region
                <input
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="us-east-1"
                  className={FIELD_MONO}
                />
              </label>
              <label className="block text-[11px] font-medium text-muted-foreground">
                AWS access key id
                <input
                  value={accessKeyId}
                  onChange={(e) => setAccessKeyId(e.target.value)}
                  placeholder="Leave blank to use the instance IAM role"
                  className={FIELD_MONO}
                />
              </label>
            </>
          ) : (
            <label className="block text-[11px] font-medium text-muted-foreground">
              Custom base URL
              <input
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder={
                  provider === 'copilot'
                    ? 'Defaults to the GitHub Copilot endpoint'
                    : 'For a gateway, proxy or self-hosted endpoint'
                }
                className={FIELD_MONO}
              />
            </label>
          )}

          <p className="pt-1 text-[11px] text-muted-foreground">
            The engine calls the model with this provider's credentials, and only from a run this workspace started.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Testing…' : 'Test & save'}
            </button>
            {saved && !error && <StatusWord tone="success" word="Verified and saved" />}
            {/* The provider's own refusal, verbatim: paraphrasing it would
                throw away the only thing that says what to change. */}
            {error && <span className="text-[11px] text-destructive">{error}</span>}
          </div>
        </form>
    </div>
  );
}

/**
 * The sections of Settings: the three the product has, then whatever this
 * edition registered. A bare `/settings` lands on the first.
 */
function settingsTabs(
  invite: InviteKind | null,
  onInviteChange: (invite: InviteKind | null) => void,
): SettingsTab[] {
  const base: SettingsTab[] = [
    {
      id: 'members',
      label: 'Members',
      render: () => <MembersTab invite={invite} onInviteChange={onInviteChange} />,
    },
    { id: 'repositories', label: 'Repositories', render: () => <RepositoriesTab /> },
    { id: 'models', label: 'Models', render: () => <ModelsTab /> },
  ];
  return [...base, ...registeredSettingsTabs()];
}

export default function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  // A local workspace is one person on one machine: there is no identity
  // provider to send an invitation through, so none is offered.
  const invitable = useServerMode() !== 'local';
  /** Which invite dialog is open, if any: by email, or by link. */
  const [invite, setInvite] = useState<InviteKind | null>(null);
  const tabs = useMemo(() => settingsTabs(invite, setInvite), [invite]);
  const active = tabs.find((t) => t.id === tab) ?? tabs[0]!;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Settings"
        right={
          active.id === 'members' && invitable && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setInvite('link')}
                className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
              >
                Invite by link
              </button>
              <button
                type="button"
                onClick={() => setInvite('email')}
                className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Invite by email
              </button>
            </div>
          )
        }
      />
      <div className="flex min-h-0 flex-1">
        <SideMenu
          label="Settings sections"
          activeId={active.id}
          items={tabs.map((t) => ({ id: t.id, label: t.label, to: `/settings/${t.id}` }))}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">{active.render()}</div>
      </div>
    </div>
  );
}
