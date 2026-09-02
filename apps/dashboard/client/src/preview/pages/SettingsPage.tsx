/**
 * Settings as a hub: members and SSO, provider connections, the LLM, the
 * connectors, and the plan. The sub-tab is in the URL, so a settings page is a
 * place a link can point at.
 *
 * Plan-gated features are SHOWN and locked, never hidden: a workspace on Team
 * can see that SSO and the connectors exist and what they would do, which is
 * the whole point of one edition with plan-gated features.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock, Plus } from 'lucide-react';
import { LLM_PROVIDER_KINDS } from '@truecourse/shared';
import type { LlmConfigResponse, LlmConfigUpdate, LlmProviderKind } from '@truecourse/shared';
import { Badge } from '@/components/ui/badge';
import { EntityList } from '@/preview/ui/entity-list';
import { StatusWord } from '@/preview/ui/status-word';
import { Capsule, Facts, ProviderIcon, PROVIDER_NAME, PageHeader, SideMenu } from '@/preview/ui/bits';
import { ENTITLEMENTS, MEMBERS } from '@/preview/data';
import { fetchLlmConfig, saveLlmConfig } from '@/preview/data/llm-config';
import type { Member, ProviderId } from '@/preview/data/types';
import { usePreviewState } from '@/preview/shell/preview-state';
import { PREVIEW_BASE } from '@/preview/shell/PreviewShell';

const TABS = [
  { id: 'members', label: 'Members' },
  { id: 'providers', label: 'Providers' },
  { id: 'models', label: 'Models' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'plan', label: 'Plan' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function Card({
  title,
  description,
  locked = false,
  children,
}: {
  title: string;
  description?: string;
  locked?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        {locked && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" />
            Enterprise plan
          </span>
        )}
      </div>
      {description && <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>}
      {children && <div className="mt-2">{children}</div>}
    </section>
  );
}

function MembersTab() {
  const [invite, setInvite] = useState(false);
  return (
    <div className="space-y-4">
      <div className="border-t border-border">
        <EntityList<Member>
          label="Workspace members"
          variant="embedded"
          items={MEMBERS}
          itemId={(m) => m.id}
          renderRow={(m) => (
            <>
              <div className="flex w-full min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{m.name}</span>
                <Capsule>{m.role}</Capsule>
              </div>
              <div className="flex w-full min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                <span className="min-w-0 truncate">{m.email}</span>
                <span className="ml-auto shrink-0">joined {m.joined}</span>
              </div>
            </>
          )}
          search={{
            placeholder: 'Search members',
            ariaLabel: 'Search members',
            match: (m, q) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
          }}
          noun={{ one: 'member', many: 'members' }}
          toolbar={
            <button
              type="button"
              onClick={() => setInvite((v) => !v)}
              className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
            >
              Invite member
            </button>
          }
        />
      </div>

      {invite && (
        <Card title="Invite a member" description="An invitation expires after seven days.">
          <div className="flex items-center gap-2">
            <input
              placeholder="name@acme.dev"
              aria-label="Invitation e-mail"
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => setInvite(false)}
              className="shrink-0 rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60"
            >
              Send
            </button>
          </div>
        </Card>
      )}

      <Card
        title="Single sign-on"
        locked
        description="SAML and SCIM provisioning, with the workspace role mapped from a directory group. Available on the Enterprise plan."
      >
        <Link to={`${PREVIEW_BASE}/settings/plan`} className="text-[11px] text-primary hover:underline">
          See the plan
        </Link>
      </Card>
    </div>
  );
}

function ProvidersTab() {
  const { connections, addConnection, revokeConnection } = usePreviewState();
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <div className="border-t border-border">
        {connections.map((c) => (
          <section key={c.id} className="flex items-center gap-3 border-b border-border/60 py-2.5">
            <ProviderIcon provider={c.provider} className="h-4 w-4" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-foreground">
                  {PROVIDER_NAME[c.provider]} · {c.account}
                </h3>
                <Capsule>{c.kind}</Capsule>
                <StatusWord tone="success" word="Connected" />
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.about}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {c.repoCount} repositories visible · connected {c.connectedAt}
              </p>
            </div>
            <button
              type="button"
              onClick={() => revokeConnection(c.id)}
              className="shrink-0 rounded border border-border px-2 py-1 text-[11px] font-medium text-destructive hover:bg-muted/60"
            >
              Revoke
            </button>
          </section>
        ))}
        {connections.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">No connection yet.</p>
        )}
      </div>
      {adding ? (
        <div className="rounded-md border border-border px-3 py-2.5">
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(['github', 'gitlab', 'azure'] as ProviderId[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  addConnection(id);
                  setAdding(false);
                }}
                className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60"
              >
                <ProviderIcon provider={id} />
                {PROVIDER_NAME[id]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="ml-auto rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60"
        >
          <Plus className="h-3 w-3" />
          Add connection
        </button>
      )}
    </div>
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
      <Card title="Active provider">
        <Facts
          rows={[
            { label: 'Provider', value: 'Claude Code (operator)' },
            { label: 'Model', value: <span className="font-mono">{data.operator.model}</span> },
            { label: 'Set by', value: <span className="font-mono">TRUECOURSE_LLM_TRANSPORT=claude-code</span> },
          ]}
        />
      </Card>
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
    <div className="space-y-4">
      {current && (
        <Card title="Active provider">
          <Facts
            rows={[
              { label: 'Provider', value: PROVIDER_LABEL[current.provider] },
              { label: 'Model', value: <span className="font-mono">{current.model}</span> },
              { label: 'Key', value: current.hasKey ? (current.keyMask ?? 'stored') : 'no stored key' },
              { label: 'Updated', value: new Date(current.updatedAt).toLocaleString() },
            ]}
          />
        </Card>
      )}

      <Card
        title="LLM provider"
        description="The engine calls the model from the hosted product only. The CLI never makes an LLM call."
      >
        <form onSubmit={submit} className="space-y-2">
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
      </Card>
    </div>
  );
}

function IntegrationsTab() {
  return (
    <div className="space-y-3">
      <Card
        title="Jira"
        locked
        description="Open a Jira issue from a gate failure, with the failing step, its evidence and the claim it breaks."
      >
        <button type="button" className="text-[11px] text-primary hover:underline">
          Upgrade to Enterprise
        </button>
      </Card>
      <Card
        title="Confluence"
        locked
        description="Read Confluence spaces as spec sources, the way an llms.txt site is read today."
      >
        <button type="button" className="text-[11px] text-primary hover:underline">
          Upgrade to Enterprise
        </button>
      </Card>
    </div>
  );
}

function PlanTab() {
  const { workspace } = usePreviewState();
  return (
    <div className="space-y-4">
      <Card title="Current plan" description="Plans decide which features are on. Nothing is hidden, only locked.">
        <Badge variant="outline" className="h-5 px-2 text-[11px]">
          {workspace.plan}
        </Badge>
      </Card>

      <div className="overflow-hidden rounded-md border border-border">
        <Facts
          rows={ENTITLEMENTS.map((e) => ({
            label: e.label,
            value: (
              <span className="inline-flex items-center gap-1.5">
                {e.locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                {e.value}
              </span>
            ),
          }))}
        />
      </div>

      <Card
        title="Self-hosted license key"
        locked
        description="A self-hosted deployment runs the same product against your own store and your own runner."
      >
        <input
          disabled
          placeholder="TC-XXXX-XXXX-XXXX"
          aria-label="Self-hosted license key"
          className="w-full cursor-not-allowed rounded border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground"
        />
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const active = useMemo<TabId>(() => (TABS.find((t) => t.id === tab)?.id ?? 'members') as TabId, [tab]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Settings" />
      <div className="flex min-h-0 flex-1">
        <SideMenu
          label="Settings sections"
          activeId={active}
          items={TABS.map((t) => ({ id: t.id, label: t.label, to: `${PREVIEW_BASE}/settings/${t.id}` }))}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-auto px-6 py-5">
          <div className="max-w-4xl">
            {active === 'members' && <MembersTab />}
            {active === 'providers' && <ProvidersTab />}
            {active === 'models' && <ModelsTab />}
            {active === 'integrations' && <IntegrationsTab />}
            {active === 'plan' && <PlanTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
