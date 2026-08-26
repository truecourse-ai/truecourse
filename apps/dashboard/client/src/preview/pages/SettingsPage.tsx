/**
 * Settings as a hub: members and SSO, provider connections, the LLM, the
 * connectors, and the plan. The sub-tab is in the URL, so a settings page is a
 * place a link can point at.
 *
 * Plan-gated features are SHOWN and locked, never hidden: a workspace on Team
 * can see that SSO and the connectors exist and what they would do, which is
 * the whole point of one edition with plan-gated features.
 */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EntityList } from '@/preview/ui/entity-list';
import { StatusWord } from '@/preview/ui/status-word';
import { Capsule, Facts, ProviderIcon, PROVIDER_NAME, PageHeader, SideMenu } from '@/preview/ui/bits';
import { ENTITLEMENTS, MEMBERS, MODELS_CONFIG } from '@/preview/data';
import type { Member, ModelsConfig, ProviderId } from '@/preview/data/types';
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

function ModelsTab() {
  const [config, setConfig] = useState<ModelsConfig>(MODELS_CONFIG);
  const [tested, setTested] = useState(false);

  return (
    <div className="space-y-4">
      <Card
        title="LLM provider"
        description="The engine calls the model from the hosted product only. The CLI never makes an LLM call."
      >
        <div className="flex flex-wrap items-center gap-1">
          {(['anthropic', 'openai', 'bedrock'] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={config.provider === p}
              onClick={() => {
                setConfig((c) => ({ ...c, provider: p }));
                setTested(false);
              }}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                config.provider === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          <label className="block text-[11px] font-medium text-muted-foreground">
            Model
            <input
              value={config.model}
              onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="block text-[11px] font-medium text-muted-foreground">
            API key
            <input
              value={config.maskedKey}
              onChange={(e) => setConfig((c) => ({ ...c, maskedKey: e.target.value }))}
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setTested(true)}
            className="rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60"
          >
            Test connection
          </button>
          {tested && <StatusWord tone="success" word="Connected" />}
        </div>
      </Card>

      <Card
        title="Metered allowance"
        description="A workspace either brings its own key or spends the product allowance. This one has both."
      >
        <div className="flex flex-wrap items-center gap-4 text-[11px]">
          <span className="text-foreground">
            Used <span className="font-mono">{config.allowanceUsed}</span>
          </span>
          <span className="text-foreground">
            Remaining <span className="font-mono">{config.allowanceLeft}</span>
          </span>
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            {config.allowancePlan}
          </Badge>
        </div>
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
