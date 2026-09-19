/**
 * Settings as a hub: the workspace's members, where its repositories are
 * connected from, the LLM provider, what its runs spent on it, and whatever
 * this edition registered beside them. The sub-tab is in the URL, so a settings page is a place a link
 * can point at.
 *
 * Everything here is the server's. There is no plan and no entitlement read yet,
 * so nothing is drawn as plan-gated: a feature that is not built says Coming
 * soon, which is what it is, rather than wearing a lock that would claim a plan
 * decides it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Unlink } from 'lucide-react';
import {
  GITHUB_CONNECT_OUTCOMES,
  GITHUB_INSTALL_ORIGINS,
  LLM_CREDITS_PROVIDER,
  LLM_PROVIDER_CHOICES,
  isCreditsProvider,
} from '@truecourse/shared';
import type {
  GithubConnectOutcome,
  GithubInstallationAccessResponse,
  GithubInstallationSummary,
  GithubRepoSummary,
  LlmConfigResponse,
  LlmConfigUpdate,
  LlmProviderChoice,
  GithubInstallOrigin,
  LocalRepositorySummary,
} from '@truecourse/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusWord } from '@/dashboard/ui/status-word';
import { Facts, ProviderIcon, PageHeader, SideMenu } from '@/dashboard/ui/bits';
import { fetchLlmConfig, saveLlmConfig } from '@/dashboard/data/llm-config';
import { offeredRepositoryProviders } from '@/dashboard/data/providers';
import {
  attachGithubInstallations,
  detachGithubInstallation,
  fetchGithubStatus,
  fetchInstallationAccess,
  installationSettingsUrl,
} from '@/dashboard/data/real-repos';
import { fetchLocalRepos } from '@/dashboard/providers/local-folder';
import { useServerMode } from '@/contexts/CapabilityContext';
import type { EnterpriseFeature, ServerMode } from '@truecourse/shared';
import { useEntitlements } from '@/auth/AuthContext';
import { MembersTab, type InviteKind } from '@/dashboard/pages/MembersTab';
import { UsageTab } from '@/dashboard/pages/UsageTab';
import { CreditsTab } from '@/dashboard/pages/CreditsTab';
import { useDashboardState } from '@/dashboard/shell/dashboard-state';
import { registeredSettingsTabs, type SettingsTab } from '@/dashboard/shell/registry';

/** What '/api/github/status' said; null while the read is in flight. */
type GithubProviderState = {
  installations: GithubInstallationSummary[];
  /**
   * The one door in: authorize with GitHub, which offers the installations
   * this person can reach and the workspace does not hold, or sends them on
   * to install. Absent on a server that has no App configured.
   */
  connectUrl: string | null;
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

/**
 * How a trip to GitHub ended, told once, as a toast: it is an event on the
 * way back, not a state of the page, so it is drawn the way every other
 * one-off outcome in the app is. `pick` is not here — it needs an answer, so
 * it is drawn inline. The title names the event; a refusal is an error toast.
 */
function toastConnectOutcome(
  outcome: Exclude<GithubConnectOutcome, 'pick'>,
  params: URLSearchParams,
): void {
  switch (outcome) {
    case 'attached': {
      const accounts = (params.get('accounts') ?? '').split(',').filter(Boolean);
      toast(accounts.length > 0 ? `Connected ${accounts.join(', ')}` : 'GitHub account connected');
      return;
    }
    case 'updated':
      toast('Repository access updated on GitHub');
      return;
    case 'requested':
      toast('Install requested on GitHub', {
        description: "The account's owners have to approve it. Connect again once they have.",
      });
      return;
    case 'none':
      toast.error('Nothing to connect', {
        description:
          'No GitHub account you have access to has the App and is not connected here already. Nothing was added.',
      });
      return;
    case 'expired':
      toast.error('Connecting to GitHub did not finish', {
        description: 'The trip took too long, or came back to another session. Nothing was added. Try again.',
      });
      return;
    case 'denied':
      toast.error('GitHub did not complete the authorization', {
        description: 'Nothing was added. Try again.',
      });
      return;
    case 'unreachable':
      toast.error('GitHub did not confirm your access to that installation', {
        description: 'Nothing was added.',
      });
      return;
  }
}

function outcomeOf(raw: string | null): GithubConnectOutcome | null {
  return raw && (GITHUB_CONNECT_OUTCOMES as readonly string[]).includes(raw)
    ? (raw as GithubConnectOutcome)
    : null;
}

/** What GitHub said an account lets the App see, or that it could not be asked. */
type InstallationAccess = GithubInstallationAccessResponse | 'unknown';

/** The access as the account line says it; empty while GitHub is still being asked. */
function accessWords(access: InstallationAccess | undefined): string {
  if (!access) return '';
  if (access === 'unknown') return 'access unknown';
  if (!access.installed) return 'no longer installed';
  if (access.repositorySelection === 'all') return 'all repositories';
  if (access.repositories === 0) return 'no repositories';
  return `${access.repositories} repositor${access.repositories === 1 ? 'y' : 'ies'}`;
}

/**
 * The pick: a trip to GitHub came back naming two or more accounts the
 * person can reach and this workspace does not hold, and none is attached
 * until they say which. A dialog over the page, every account ticked, one
 * button that says how many; Cancel attaches nothing.
 */
function ConnectAccountsDialog({
  offered,
  busy,
  onCancel,
  onConnect,
}: {
  offered: GithubInstallationSummary[];
  busy: boolean;
  onCancel: () => void;
  onConnect: (installationIds: number[]) => void;
}) {
  const [picked, setPicked] = useState<number[]>(() => offered.map((i) => i.installationId));
  const toggle = (id: number, on: boolean) =>
    setPicked((prev) => (on ? [...new Set([...prev, id])] : prev.filter((p) => p !== id)));
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect GitHub accounts</DialogTitle>
          <DialogDescription>
            GitHub named {offered.length} accounts you have access to that this workspace does not use yet.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border rounded-md border border-border" aria-label="Offered GitHub accounts">
          {offered.map((i) => {
            const name = i.accountLogin || `#${i.installationId}`;
            const sees =
              i.repositorySelection === 'all'
                ? 'All repositories'
                : i.repositorySelection === 'selected'
                  ? 'Selected repositories'
                  : '';
            return (
              <li key={i.installationId}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs">
                  <input
                    type="checkbox"
                    checked={picked.includes(i.installationId)}
                    onChange={(e) => toggle(i.installationId, e.target.checked)}
                    disabled={busy}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground">{name}</span>
                    {i.accountType ? (
                      <span className="text-muted-foreground"> · {i.accountType.toLowerCase()}</span>
                    ) : null}
                    {sees && <span className="block text-[11px] text-muted-foreground">{sees}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <DialogFooter className="mt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConnect(picked)}
            disabled={busy || picked.length === 0}
            className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? 'Connecting'
              : `Connect ${picked.length} account${picked.length === 1 ? '' : 's'}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one destructive action on the page asks first, in the app's own dialog:
 * what leaves with the account (its repositories connected here, the Context
 * sources reading through it), then Remove or not. When this is the LAST
 * workspace holding the installation, removing it uninstalls the App from
 * the account on GitHub too, and the dialog says so: the next Connect then
 * starts from GitHub's install page, repositories picked afresh.
 */
function RemoveAccountDialog({
  installation,
  linked,
  onCancel,
  onConfirm,
}: {
  installation: GithubInstallationSummary | null;
  linked: GithubRepoSummary[];
  onCancel: () => void;
  onConfirm: (installation: GithubInstallationSummary) => void;
}) {
  const name = installation ? installation.accountLogin || `#${installation.installationId}` : '';
  const others = Math.max((installation?.workspaces ?? 1) - 1, 0);
  const last = others === 0;
  return (
    <Dialog open={installation !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{last ? `Remove ${name} and uninstall the App?` : `Remove ${name} from this workspace?`}</DialogTitle>
          <DialogDescription>
            {last
              ? `No other workspace uses ${name}, so the App will be uninstalled from it on GitHub. Connecting it again means installing the App again and picking its repositories.`
              : `${others} other workspace${others === 1 ? '' : 's'} keep${others === 1 ? 's' : ''} it. The App stays installed on GitHub.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-xs text-muted-foreground">
          {linked.length > 0 ? (
            <p>
              {linked.length} repositor{linked.length === 1 ? 'y' : 'ies'} connected through it will be
              disconnected, with {linked.length === 1 ? 'its' : 'their'} runs and evidence:
            </p>
          ) : (
            <p>No repository is connected through it.</p>
          )}
          {linked.length > 0 && (
            <ul className="font-mono text-foreground">
              {linked.map((r) => (
                <li key={r.repoFullName}>{r.repoFullName}</li>
              ))}
            </ul>
          )}
          <p>Context sources that read through it stop syncing until it is connected again.</p>
        </div>
        <DialogFooter className="mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => installation && onConfirm(installation)}
            className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90"
          >
            {last ? 'Remove and uninstall' : 'Remove'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Repositories: where they are connected FROM. One row per source-control
 * provider — its mark, its name, a status word, and the accounts under it,
 * one line each.
 *
 * GitHub is the real one: its accounts are the App's installations the server
 * reports, one line each naming the account, its type and what it lets the
 * App see (asked of GitHub, since this page is about the connection, not
 * what Code has used), with its two actions on the line. Adding one is ONE
 * button, a top-level navigation to GitHub's authorize page: one new account
 * comes back attached, two or more come back HERE as a pick in a dialog
 * (nothing is attached without a choice), none goes on to GitHub's install
 * page, and an install comes back attached. Every trip that did not attach
 * lands here too, told as a toast, wherever it started. On a local server the folders of this
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
  // A trip to GitHub that did not attach lands here flagged with how it
  // ended, told as a toast; a `pick` carries the offer of accounts the person
  // can choose from, drawn inline.
  const outcome = outcomeOf(params.get('github'));
  const offer = outcome === 'pick' ? params.get('offer') : null;
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
        linked: status.repos,
        offered: status.offered ?? null,
      });
    } catch (error: unknown) {
      apply({
        installations: [],
        connectUrl: null,
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

  // Tell how the trip ended, once, then drop the flag from the address so a
  // reload does not tell it again. `from` stays: the Connect link minted for
  // this page still returns there. The landing is a fresh page, and this
  // effect runs before the app's Toaster has subscribed to the toast store,
  // which keeps no history — so the toast waits a tick for it.
  const told = useRef(false);
  useEffect(() => {
    if (!outcome || outcome === 'pick' || told.current) return;
    told.current = true;
    // Not cleared on cleanup: dropping the flag re-runs this effect at once,
    // and the toast has to outlive that.
    setTimeout(() => toastConnectOutcome(outcome, params), 0);
    const next = new URLSearchParams(params);
    next.delete('github');
    setParams(next, { replace: true });
  }, [outcome, params, setParams]);

  /** Drop the landing's flags: the pick is over, one way or the other. */
  const closePick = () => setParams(new URLSearchParams(), { replace: true });

  // The pick: attach what is ticked, then carry on where the trip started —
  // or, for a trip started here, drop the landing's flags and read afresh.
  const attachPicked = async (installationIds: number[]) => {
    if (!offer || installationIds.length === 0) return;
    setAttaching(true);
    try {
      await attachGithubInstallations({ offer, installationIds });
      if (from !== 'settings') {
        navigate(RETURN_TO[from]);
        return;
      }
      closePick();
    } catch (error: unknown) {
      toast.error('Could not connect the accounts', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setAttaching(false);
    }
  };

  // An offer the server no longer honours (expired, or another session's)
  // is told like any other outcome and dropped from the address.
  const offerRefused = outcome === 'pick' && github !== null && github.offered === null;
  useEffect(() => {
    if (!offerRefused) return;
    setTimeout(() => toast.error('That offer expired', { description: 'Connect again to get a fresh one.' }), 0);
    closePick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerRefused]);

  // What each account lets the App see, asked of GitHub one account at a
  // time once the accounts are known. The Settings page is about the
  // connection, so this is the count it draws, not what Code has used.
  const [access, setAccess] = useState<Record<number, InstallationAccess>>({});
  useEffect(() => {
    if (!github) return;
    let live = true;
    for (const installation of github.installations) {
      const id = installation.installationId;
      if (access[id]) continue;
      void fetchInstallationAccess(id)
        .then((answer) => {
          if (live) setAccess((prev) => ({ ...prev, [id]: answer }));
        })
        .catch(() => {
          if (live) setAccess((prev) => ({ ...prev, [id]: 'unknown' }));
        });
    }
    return () => {
      live = false;
    };
    // Only a new account needs asking; a re-read of the same accounts does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [github]);

  // Detach an installation from this workspace: the repositories connected
  // through it here go with it, so the person is shown which before it does.
  // A detach the server could only half do is re-read either way, so the page
  // shows what is actually left and the reason beside it.
  const [removing, setRemoving] = useState<GithubInstallationSummary | null>(null);
  const detach = useCallback(
    async (installation: GithubInstallationSummary) => {
      setRemoving(null);
      setDetaching(installation.installationId);
      const name = installation.accountLogin || `#${installation.installationId}`;
      let failure: string | null = null;
      try {
        const answer = await detachGithubInstallation(installation.installationId);
        // Told as it went: gone from GitHub too, still on GitHub because
        // GitHub refused (the one thing left to do by hand), or kept for
        // the other workspaces.
        if (answer.uninstall === 'done') {
          toast(`Removed ${name}`, { description: 'The App was uninstalled from it on GitHub.' });
        } else if (answer.uninstall === 'failed') {
          toast.error(`Removed ${name} here, but the App is still installed on GitHub`, {
            description: `${answer.reason ?? 'GitHub refused the uninstall.'} Uninstall it on GitHub.`,
          });
        } else {
          toast(`Removed ${name} from this workspace`);
        }
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
    [readGithub, refreshRealRepos],
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
  /** The accounts a pick landing offers, once the server has confirmed the offer. */
  const offered = outcome === 'pick' ? (github?.offered ?? []) : [];

  return (
    <>
    {offered.length > 0 && (
      <ConnectAccountsDialog
        offered={offered}
        busy={attaching}
        onCancel={closePick}
        onConnect={(ids) => void attachPicked(ids)}
      />
    )}
    <RemoveAccountDialog
      installation={removing}
      linked={(github?.linked ?? []).filter((r) => r.installationId === removing?.installationId)}
      onCancel={() => setRemoving(null)}
      onConfirm={(installation) => void detach(installation)}
    />
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
              {/* The accounts held, one line each with its two actions. */}
              {isGithub && installations.length > 0 && (
                <ul className="mt-2 divide-y divide-border border-y border-border" aria-label="GitHub accounts">
                  {installations.map((i) => {
                    const name = i.accountLogin || `#${i.installationId}`;
                    const sees = accessWords(access[i.installationId]);
                    return (
                      <li key={i.installationId} className="flex items-center gap-3 py-1.5 text-xs">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-foreground">{name}</span>
                          <span className="text-muted-foreground">
                            {i.accountType ? ` · ${i.accountType.toLowerCase()}` : ''}
                            {sees ? ` · ${sees}` : ''}
                          </span>
                        </span>
                        {/* Which repositories the App can see is GitHub's
                            setting, on the installation's own page there. */}
                        <a
                          href={installationSettingsUrl(i)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Manage ${name} on GitHub`}
                          className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Manage on GitHub
                        </a>
                        {/* Unlink, not delete: the installation stays on
                            GitHub, this workspace lets go of it. */}
                        <button
                          type="button"
                          onClick={() => setRemoving(i)}
                          disabled={detaching !== null}
                          aria-label={`Remove ${name}`}
                          title="Remove from this workspace"
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                        >
                          <Unlink className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
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
    </>
  );
}

const PROVIDER_LABEL: Record<LlmProviderChoice, string> = {
  anthropic: 'Anthropic API',
  openai: 'OpenAI',
  bedrock: 'AWS Bedrock',
  copilot: 'GitHub Copilot',
  truecourse: 'TrueCourse credits',
};

const MODEL_PLACEHOLDER: Record<LlmProviderChoice, string> = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-5.6',
  bedrock: 'anthropic.claude-opus-5',
  copilot: 'gpt-5.6',
  truecourse: '',
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

  const [provider, setProvider] = useState<LlmProviderChoice>('anthropic');
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
  // The credits choice has no key field and no model field — there is nothing
  // of the platform's to show, masked or otherwise.
  const onCredits = isCreditsProvider(provider);
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
    // Credits store nothing: no key to send, no model to name, no endpoint.
    const update: LlmConfigUpdate = onCredits
      ? { provider }
      : {
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
          rows={
            isCreditsProvider(current.provider)
              ? [
                  { label: 'Provider', value: PROVIDER_LABEL.truecourse },
                  {
                    label: 'Balance',
                    value: (
                      <span className="tabular-nums">
                        {(data?.credits?.balance ?? 0).toLocaleString()} credits
                      </span>
                    ),
                  },
                  { label: 'Updated', value: new Date(current.updatedAt).toLocaleString() },
                ]
              : [
                  { label: 'Provider', value: PROVIDER_LABEL[current.provider] },
                  { label: 'Model', value: <span className="font-mono">{current.model}</span> },
                  { label: 'Key', value: current.hasKey ? (current.keyMask ?? 'stored') : 'no stored key' },
                  { label: 'Updated', value: new Date(current.updatedAt).toLocaleString() },
                ]
          }
        />
      )}

        <form onSubmit={submit} className="max-w-xl space-y-2 px-6 py-5">
          <label className="block text-[11px] font-medium text-muted-foreground">
            Provider
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as LlmProviderChoice)}
              className={FIELD}
            >
              {(data?.providers ?? LLM_PROVIDER_CHOICES).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          {onCredits ? (
            <p className="pt-1 text-[11px] text-muted-foreground">
              Runs go through TrueCourse&rsquo;s own key and come out of this workspace&rsquo;s
              balance:{' '}
              <span className="tabular-nums text-foreground">
                {(data?.credits?.balance ?? 0).toLocaleString()} credits
              </span>
              . There is no key to paste and no model to pick.{' '}
              <Link to="/settings/credits" className="text-foreground underline underline-offset-2">
                Credits
              </Link>{' '}
              is where the balance and what spent it are.
            </p>
          ) : (
            <>
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
            </>
          )}

          {!onCredits && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              The engine calls the model with this provider&rsquo;s credentials, and only from a run
              this workspace started.
            </p>
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
    </div>
  );
}

/**
 * The sections of Settings: the ones the product has, then whichever of this
 * edition's the workspace is entitled to. A bare `/settings` lands on the first,
 * and an address whose section is not this workspace's lands there too.
 */
function settingsTabs(
  invite: InviteKind | null,
  onInviteChange: (invite: InviteKind | null) => void,
  mode: ServerMode,
  entitlements: ReadonlySet<EnterpriseFeature>,
): SettingsTab[] {
  const base: SettingsTab[] = [
    {
      id: 'members',
      label: 'Members',
      render: () => <MembersTab invite={invite} onInviteChange={onInviteChange} />,
    },
    { id: 'repositories', label: 'Repositories', render: () => <RepositoriesTab /> },
    { id: 'models', label: 'Models', render: () => <ModelsTab /> },
    { id: 'usage', label: 'Usage', render: () => <UsageTab /> },
    // Credits are TrueCourse's own key on a granted balance. A local machine
    // has no operator to grant anything and no platform key to spend, so the
    // tab is not there at all.
    ...(mode === 'local'
      ? []
      : [{ id: 'credits', label: 'Credits', render: () => <CreditsTab /> }]),
  ];
  // A registered section that names a grant is drawn only for a workspace that
  // holds it: registering it says this bundle CARRIES it, not that this
  // workspace may use it.
  return [
    ...base,
    ...registeredSettingsTabs().filter(
      (tab) => !tab.entitlement || entitlements.has(tab.entitlement),
    ),
  ];
}

export default function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  // A local workspace is one person on one machine: there is no identity
  // provider to send an invitation through, so none is offered.
  const mode = useServerMode();
  const invitable = mode !== 'local';
  /** Which invite dialog is open, if any: by email, or by link. */
  const [invite, setInvite] = useState<InviteKind | null>(null);
  const entitlements = useEntitlements();
  const tabs = useMemo(
    () => settingsTabs(invite, setInvite, mode, entitlements),
    [invite, mode, entitlements],
  );
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
