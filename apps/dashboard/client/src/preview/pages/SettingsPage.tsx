/**
 * Settings as a hub: the workspace's members, where its repositories are
 * connected from, the document connectors, and the LLM provider. The sub-tab
 * is in the URL, so a settings page is a place a link can point at.
 *
 * Everything here is the server's. There is no plan and no entitlement read yet,
 * so nothing is drawn as plan-gated: a feature that is not built says Coming
 * soon, which is what it is, rather than wearing a lock that would claim a plan
 * decides it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CONTEXT_SOURCE_KIND_LABEL, LLM_PROVIDER_KINDS } from '@truecourse/shared';
import type {
  ContextSourceKind,
  GithubInstallationSummary,
  GithubRepoSummary,
  LlmConfigResponse,
  LlmConfigUpdate,
  LlmProviderKind,
} from '@truecourse/shared';
import { ConnectorLogo, type ConnectorTool } from '@/preview/ui/connector-logos';
import { StatusWord } from '@/preview/ui/status-word';
import { Facts, ProviderIcon, PROVIDER_NAME, PageHeader, SideMenu } from '@/preview/ui/bits';
import { fetchLlmConfig, saveLlmConfig } from '@/preview/data/llm-config';
import { fetchGithubStatus } from '@/preview/data/real-repos';
import type { ProviderId } from '@/preview/data/types';
import { MembersTab } from '@/preview/pages/MembersTab';
import { usePreviewState } from '@/preview/shell/preview-state';
import { PREVIEW_BASE } from '@/preview/shell/PreviewShell';

const TABS = [
  { id: 'members', label: 'Members' },
  { id: 'repositories', label: 'Repositories' },
  { id: 'connections', label: 'Connections' },
  { id: 'models', label: 'Models' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** What `/api/github/status` said; null while the read is in flight. */
type GithubProviderState = {
  installations: GithubInstallationSummary[];
  /** Where the App is installed. Absent on a server that has no App configured. */
  installUrl: string | null;
  /** The repositories linked to this workspace, per installation. */
  linked: GithubRepoSummary[];
  /** Why the read failed, when it did. */
  reason?: string;
};

/** The providers a repository can be connected from, in the order they are offered. */
const PROVIDERS: readonly ProviderId[] = ['github', 'gitlab', 'azure'];

/**
 * Repositories: where they are connected FROM. One row per source-control
 * provider — its mark, its name, a status word, and the accounts under it,
 * one line each.
 *
 * GitHub is the real one: its accounts are the App's installations the server
 * reports, each line naming the account, its type and how many repositories
 * this workspace has linked through it, and connecting is a top-level
 * navigation to the App's install page. GitLab and Azure DevOps are listed and
 * say Coming soon: hiding them would make the page lie about where this is
 * going, and offering them would make it lie about what it does.
 */
function RepositoriesTab() {
  const [github, setGithub] = useState<GithubProviderState | null>(null);

  useEffect(() => {
    let live = true;
    void fetchGithubStatus()
      .then((status) => {
        if (!live) return;
        setGithub({
          installations: status.installations,
          installUrl: status.installUrl || null,
          linked: status.repos,
        });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setGithub({
          installations: [],
          installUrl: null,
          linked: [],
          reason: error instanceof Error ? error.message : 'GitHub could not be reached',
        });
      });
    return () => {
      live = false;
    };
  }, []);

  const installations = github?.installations ?? [];

  return (
    <ul className="divide-y divide-border border-b border-border" aria-label="Providers">
      {PROVIDERS.map((id) => {
        const live = id === 'github';
        return (
          <li key={id} className="flex items-start gap-4 px-6 py-3">
            <ProviderIcon provider={id} className="mt-0.5 h-6 w-6 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-medium text-foreground">{PROVIDER_NAME[id]}</span>
                {!live && <span className="text-[11px] text-muted-foreground">Coming soon</span>}
                {live && github === null && <StatusWord tone="neutral" word="Reading" />}
                {live && github !== null && (
                  <StatusWord
                    tone={installations.length > 0 ? 'success' : 'neutral'}
                    word={installations.length > 0 ? 'Connected' : 'Not connected'}
                  />
                )}
              </div>
              {live && github?.reason && (
                <p className="mt-1 text-[11px] text-destructive">{github.reason}</p>
              )}
              {live && installations.length > 0 && (
                <ul className="mt-1 space-y-1" aria-label="GitHub installations">
                  {installations.map((i) => {
                    const linked = (github?.linked ?? []).filter(
                      (r) => r.installationId === i.installationId,
                    ).length;
                    return (
                      <li key={i.installationId} className="truncate text-[11px] text-muted-foreground">
                        <span className="text-foreground">{i.accountLogin || `#${i.installationId}`}</span>
                        {i.accountType ? ` · ${i.accountType.toLowerCase()}` : ''} ·{' '}
                        {linked} repositor{linked === 1 ? 'y' : 'ies'} linked
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {live && github?.installUrl && (
              <a
                href={github.installUrl}
                className={`shrink-0 rounded px-2.5 py-1.5 text-xs font-medium ${
                  installations.length === 0
                    ? 'bg-primary text-primary-foreground hover:opacity-90'
                    : 'border border-border text-foreground hover:bg-muted/60'
                }`}
              >
                {installations.length === 0 ? 'Connect' : 'Add account'}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The tools a document can come from, one row each with its brand mark and the
 * shared name of its kind. None can be connected yet, so every row says Coming
 * soon and none of them is a control: hiding them would make the page lie about
 * where this is going, and offering them would make it lie about what it does.
 */
const CONNECTORS: readonly { kind: ContextSourceKind; tool: ConnectorTool }[] = [
  { kind: 'jira', tool: 'jira' },
  { kind: 'confluence', tool: 'confluence' },
  { kind: 'google-drive', tool: 'gdrive' },
  { kind: 'onedrive', tool: 'onedrive' },
  { kind: 'notion', tool: 'notion' },
  { kind: 'slack', tool: 'slack' },
];

function ConnectionsTab() {
  return (
    <ul className="divide-y divide-border border-b border-border" aria-label="Connectors">
      {CONNECTORS.map((connector) => (
        <li key={connector.kind} className="flex items-start gap-4 px-6 py-3">
          <ConnectorLogo tool={connector.tool} className="mt-0.5 h-6 w-6 shrink-0" />
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="truncate text-[13px] font-medium text-foreground">
              {CONTEXT_SOURCE_KIND_LABEL[connector.kind]}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">Coming soon</span>
          </div>
        </li>
      ))}
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
  const { refreshLlmProvider } = usePreviewState();
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
            The engine calls the model from the hosted product only. The CLI never makes an LLM call.
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

export default function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const active = useMemo<TabId>(
    () => (TABS.find((t) => t.id === tab)?.id ?? 'members') as TabId,
    [tab],
  );

  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Settings"
        right={
          active === 'members' && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Invite member
            </button>
          )
        }
      />
      <div className="flex min-h-0 flex-1">
        <SideMenu
          label="Settings sections"
          activeId={active}
          items={TABS.map((t) => ({ id: t.id, label: t.label, to: `${PREVIEW_BASE}/settings/${t.id}` }))}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {active === 'members' && (
            <MembersTab inviteOpen={inviteOpen} onInviteOpenChange={setInviteOpen} />
          )}
          {active === 'repositories' && <RepositoriesTab />}
          {active === 'connections' && <ConnectionsTab />}
          {active === 'models' && <ModelsTab />}
        </div>
      </div>
    </div>
  );
}
