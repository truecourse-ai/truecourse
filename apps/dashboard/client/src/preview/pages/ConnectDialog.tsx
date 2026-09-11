// PREVIEW: the GitHub path here is REAL (it links through the App); GitLab and
// Azure beside it are mocks.

/**
 * Connect a repository: pick a provider (a provider with nothing connected
 * authorizes first), pick the account and the repositories it can see, pick the
 * CONTEXT each of them reads, confirm. The repository then appears on Code with
 * its onboarding chain in flight. Opened from Code.
 *
 * THE CONTEXT STEP is real for GitHub: the workspace's sources come from
 * `GET /api/context/sources`, and the repository's OWN documentation leads the
 * list, checked — it is not a workspace source yet, it is the Repository source
 * connecting creates, so it is read back off the sources list after the link
 * rather than composed from a name. What the step picked is written per
 * repository with `PUT /api/repos/:id/context/bindings` once the link landed.
 *
 * GITHUB IS THE REAL ONE. The row reads `/api/github/status`: the App's
 * installations on this workspace and the repositories already linked. An
 * installation lists what it can see; connecting posts one repository at a time
 * to `/api/github/repos/link` — the row is the connection (the onboarding scan
 * clones for itself in the background), so each request is quick, but the
 * per-repository outcome still matters: a failure leaves the dialog standing
 * rather than swallowing the rest of the batch.
 * Installing the App is a top-level navigation to GitHub; its setup redirect
 * lands back on `/preview/code?connect=1`, so a new installation is pickable at once.
 *
 * GitLab and Azure are still the fixture flow: authorize, pick, confirm, and the
 * rows they add are mock rows.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Capsule, ProviderIcon, PROVIDER_NAME } from '@/preview/ui/bits';
import type {
  ContextSourceView,
  GithubInstallableRepo,
  GithubInstallationSummary,
  RepositorySourceConfig,
} from '@truecourse/shared';
import { CONTEXT_SOURCE_KIND_LABEL } from '@truecourse/shared';
import { listContextSources, putRepoContextBindings } from '@/lib/api';
import type { ProviderId } from '@/preview/data/types';
import {
  fetchGithubStatus,
  fetchInstallationRepos,
  linkGithubRepo,
} from '@/preview/data/real-repos';
import { usePreviewState } from '@/preview/shell/preview-state';
import { PREVIEW_BASE } from '@/preview/shell/base';
import { toastNoLlmProvider } from '@/preview/shell/use-run-trigger';

const PROVIDER_OPTIONS: ProviderId[] = ['github', 'gitlab', 'azure'];

const ACTION = 'shrink-0 rounded px-2 py-1 text-[11px] font-medium';
const ACTION_OUTLINE = `${ACTION} border border-border text-foreground hover:bg-muted/60`;
const ACTION_PRIMARY = `${ACTION} bg-primary text-primary-foreground hover:opacity-90`;
const CHIP = 'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors';
const ADD_CHIP =
  'inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground';

/**
 * What the server says about GitHub. `unavailable` is both an unconfigured
 * server (503, whose message names the variables to set) and a refused read:
 * either way the reason is all this dialog can offer, and there is nothing to
 * retry from here.
 */
type GithubStatus =
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: string }
  | {
      kind: 'ready';
      installUrl: string;
      installations: GithubInstallationSummary[];
      /** Full names already linked to this workspace. */
      linked: string[];
    };

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'GitHub could not be reached';

export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const {
    connections,
    connectableRepos,
    addConnection,
    connectRepositories,
    privateReposUsed,
    privateRepoLimit,
    repos,
    refreshRealRepos,
    llmProvider,
  } = usePreviewState();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [provider, setProvider] = useState<ProviderId>('github');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  /**
   * The Context step. The repository's OWN documentation is not a workspace
   * source yet — it is the Repository source connecting creates — so it is a
   * flag here and an id only after the link, while `contextPicked` holds the
   * workspace sources that already exist.
   */
  const [ownDocs, setOwnDocs] = useState(true);
  const [contextPicked, setContextPicked] = useState<string[]>([]);
  /** The workspace's sources; null while they are being read. */
  const [sources, setSources] = useState<ContextSourceView[] | null>(null);
  const [github, setGithub] = useState<GithubStatus>({ kind: 'loading' });
  const [installationId, setInstallationId] = useState<number | null>(null);
  /** The installation's repositories; null while they are being read. */
  const [installationRepos, setInstallationRepos] = useState<GithubInstallableRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  /** Index of the repository being cloned, or null when nothing is in flight. */
  const [linking, setLinking] = useState<number | null>(null);
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});

  const isGithub = provider === 'github';

  useEffect(() => {
    if (!open) {
      setStep(1);
      setPicked([]);
      setProvider('github');
      setConnectionId(null);
      setInstallationId(null);
      setInstallationRepos(null);
      setReposError(null);
      setLinking(null);
      setLinkErrors({});
      setOwnDocs(true);
      setContextPicked([]);
    }
  }, [open]);

  // The workspace's context, read each time the dialog opens. With no server to
  // ask the step still stands: the repository's own documentation is the one
  // source connecting always creates.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setSources(null);
    void listContextSources()
      .then((answer) => {
        if (live) setSources(answer.sources);
      })
      .catch(() => {
        if (live) setSources([]);
      });
    return () => {
      live = false;
    };
  }, [open]);

  // The App's state, read each time the dialog opens — the user may have just
  // come back from installing it.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setGithub({ kind: 'loading' });
    void fetchGithubStatus()
      .then((status) => {
        if (!live) return;
        setGithub({
          kind: 'ready',
          installUrl: status.installUrl,
          installations: status.installations,
          linked: status.repos.map((r) => r.repoFullName),
        });
      })
      .catch((error: unknown) => {
        if (live) setGithub({ kind: 'unavailable', reason: reasonOf(error) });
      });
    return () => {
      live = false;
    };
  }, [open]);

  // What the selected installation can see.
  useEffect(() => {
    if (installationId === null) return;
    let live = true;
    setInstallationRepos(null);
    setReposError(null);
    void fetchInstallationRepos(installationId)
      .then((found) => {
        if (live) setInstallationRepos(found);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setInstallationRepos([]);
        setReposError(reasonOf(error));
      });
    return () => {
      live = false;
    };
  }, [installationId]);

  const accounts = connections.filter((c) => c.provider === provider);
  const connection = accounts.find((c) => c.id === connectionId) ?? accounts[0] ?? null;
  const available = connectableRepos.filter(
    (c) => c.connectionId === connection?.id && !repos.some((r) => r.fullName === c.fullName),
  );
  const pickedPrivate = available.filter((c) => picked.includes(c.fullName) && c.visibility === 'private').length;
  const overAllowance = !isGithub && privateReposUsed + pickedPrivate > privateRepoLimit;

  const toggle = (fullName: string) =>
    setPicked((prev) => (prev.includes(fullName) ? prev.filter((n) => n !== fullName) : [...prev, fullName]));

  /**
   * What the Context step picked, written as each landed repository's bindings:
   * the workspace sources it checked, plus the repository's OWN source — read
   * back off the sources list the link just added it to, never composed from a
   * name. A repository whose source has not appeared yet is bound to what it
   * did pick; the binding a failed write leaves unmade is spoken, since the
   * repository is connected either way.
   */
  const bindContext = async (landed: readonly string[], connected: readonly { id: string; fullName: string }[]) => {
    if (landed.length === 0) return;
    let workspaceSources: ContextSourceView[] = [];
    try {
      workspaceSources = (await listContextSources()).sources;
    } catch {
      // No sources to read is not a reason to skip what the step picked.
    }
    setSources(workspaceSources);
    for (const fullName of landed) {
      const repoId = connected.find((r) => r.fullName === fullName)?.id;
      if (!repoId) continue;
      const own = ownDocs
        ? workspaceSources.find(
            (source) =>
              source.kind === 'repository' &&
              (source.config as RepositorySourceConfig).repoFullName === fullName,
          )?.id
        : undefined;
      const ids = [...new Set([...contextPicked, ...(own ? [own] : [])])];
      try {
        await putRepoContextBindings(repoId, ids);
      } catch (error) {
        toast.error(`Could not set the context of ${fullName}`, { description: reasonOf(error) });
      }
    }
  };

  /** Pick a provider: straight to its repositories, authorizing first when nothing is connected yet. */
  const choose = (id: ProviderId) => {
    setProvider(id);
    setPicked([]);
    if (id === 'github') {
      if (github.kind !== 'ready') return;
      setInstallationId(github.installations[0]?.installationId ?? null);
      setStep(2);
      return;
    }
    const existing = connections.filter((c) => c.provider === id);
    setConnectionId(existing[0]?.id ?? addConnection(id).id);
    setStep(2);
  };

  /**
   * The real one: one link request per repository, in order — each a quick row
   * write (the onboarding scan clones for itself in the background). A refusal
   * is kept against its repository and the batch carries on; the dialog only
   * closes when every one landed. What did land drops out of the selection AND
   * into `github.linked`, so after a partial failure the landed repositories
   * render connected/disabled instead of inviting a duplicate link.
   */
  const connectGithub = async () => {
    if (github.kind !== 'ready' || installationId === null || linking !== null) return;
    const targets = (installationRepos ?? []).filter((r) => picked.includes(r.fullName));
    const failures: Record<string, string> = {};
    setLinkErrors({});
    for (const [index, repo] of targets.entries()) {
      setLinking(index);
      try {
        await linkGithubRepo({
          repoFullName: repo.fullName,
          installationId,
          defaultBranch: repo.defaultBranch,
        });
      } catch (error) {
        failures[repo.fullName] = reasonOf(error);
      }
    }
    const landed = targets.map((r) => r.fullName).filter((name) => !failures[name]);
    setLinking(null);
    setLinkErrors(failures);
    setPicked((prev) => prev.filter((name) => failures[name]));
    setGithub((prev) =>
      prev.kind === 'ready' && landed.length > 0
        ? { ...prev, linked: [...prev.linked, ...landed.filter((n) => !prev.linked.includes(n))] }
        : prev,
    );
    // Whatever landed is a real repository now, failures beside it or not —
    // and the fresh registry is what names each one's id, which is what the
    // bindings are written against.
    const connected = await refreshRealRepos();
    await bindContext(landed, connected);
    // Connected but unscannable must not pass silently: the row landed, the
    // onboarding scan did not start, and the toast names the remedy.
    if (landed.length > 0 && llmProvider === 'missing') {
      toastNoLlmProvider(
        navigate,
        landed.length === 1
          ? `${landed[0]} is connected, but its scan cannot start until a provider is set.`
          : `${landed.length} repositories are connected, but their scans cannot start until a provider is set.`,
      );
    }
    if (Object.keys(failures).length === 0) onOpenChange(false);
  };

  /** The provider row's own words and its one action; GitHub's come from the server. */
  const providerRow = (id: ProviderId): { subtitle: ReactNode; action: ReactNode } => {
    if (id !== 'github') {
      const mine = connections.filter((c) => c.provider === id);
      return {
        subtitle: (
          <span className="block truncate text-[11px] text-muted-foreground">
            {mine.length === 0 ? 'not connected yet' : mine.map((c) => `${c.account} (${c.kind})`).join(' · ')}
          </span>
        ),
        action: (
          <button
            type="button"
            onClick={() => choose(id)}
            className={mine.length === 0 ? ACTION_OUTLINE : ACTION_PRIMARY}
          >
            {mine.length === 0 ? 'Connect' : 'Select'}
          </button>
        ),
      };
    }
    if (github.kind === 'loading') {
      return { subtitle: <span className="block text-[11px] text-muted-foreground">reading installations</span>, action: null };
    }
    if (github.kind === 'unavailable') {
      return { subtitle: <span className="block text-[11px] text-destructive">{github.reason}</span>, action: null };
    }
    if (github.installations.length === 0) {
      return {
        subtitle: <span className="block text-[11px] text-muted-foreground">the app is not installed yet</span>,
        action: github.installUrl ? (
          <a href={github.installUrl} className={ACTION_OUTLINE}>
            Install
          </a>
        ) : null,
      };
    }
    return {
      subtitle: (
        <span className="block truncate text-[11px] text-muted-foreground">
          {github.installations.map((i) => i.accountLogin || `#${i.installationId}`).join(' · ')}
        </span>
      ),
      action: (
        <button type="button" onClick={() => choose('github')} className={ACTION_PRIMARY}>
          Select
        </button>
      ),
    };
  };

  // A batch in flight owns the dialog: Escape/overlay/X must not close it —
  // closing resets the state the loop is still writing, and reopening would
  // let a second batch race the first. The footer buttons are already
  // disabled; this closes the three other doors.
  const guardedOpenChange = (next: boolean) => {
    if (!next && linking !== null) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={guardedOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a repository</DialogTitle>
          <DialogDescription>
            Step {step} of 4 ·{' '}
            {step === 1
              ? 'pick a provider'
              : step === 2
                ? 'pick repositories'
                : step === 3
                  ? 'pick the context they read'
                  : 'confirm and start onboarding'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {PROVIDER_OPTIONS.map((id) => {
              const { subtitle, action } = providerRow(id);
              return (
                <li key={id} className="flex items-center gap-3 px-3 py-2.5">
                  <ProviderIcon provider={id} className="h-4 w-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-foreground">{PROVIDER_NAME[id]}</span>
                    {subtitle}
                  </span>
                  {action}
                </li>
              );
            })}
          </ul>
        )}

        {step === 2 && isGithub && github.kind === 'ready' && (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Installation</span>
              {github.installations.map((i) => (
                <button
                  key={i.installationId}
                  type="button"
                  aria-pressed={installationId === i.installationId}
                  onClick={() => {
                    setInstallationId(i.installationId);
                    setPicked([]);
                  }}
                  className={`${CHIP} ${
                    installationId === i.installationId
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/70'
                  }`}
                >
                  {i.accountLogin || `#${i.installationId}`}
                </button>
              ))}
              {github.installUrl && (
                <a href={github.installUrl} className={ADD_CHIP}>
                  <Plus className="h-3 w-3" />
                  Add another
                </a>
              )}
            </div>
            <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {installationRepos === null && (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">Reading repositories</li>
              )}
              {reposError && <li className="px-3 py-6 text-center text-xs text-destructive">{reposError}</li>}
              {installationRepos?.length === 0 && !reposError && (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  This installation can see no repositories. Grant the app access on GitHub.
                </li>
              )}
              {(installationRepos ?? []).map((r) => {
                const linked = github.linked.includes(r.fullName);
                return (
                  <li key={r.fullName} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      id={`pick-${r.fullName}`}
                      disabled={linked}
                      checked={picked.includes(r.fullName)}
                      onChange={() => toggle(r.fullName)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-border disabled:opacity-40"
                    />
                    <label
                      htmlFor={`pick-${r.fullName}`}
                      className={`min-w-0 flex-1 ${linked ? 'opacity-60' : 'cursor-pointer'}`}
                    >
                      <span className="block truncate font-mono text-xs text-foreground">{r.fullName}</span>
                    </label>
                    <Capsule>{linked ? 'connected' : r.private ? 'private' : 'public'}</Capsule>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {step === 2 && !isGithub && (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Account</span>
              {accounts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={connection?.id === c.id}
                  onClick={() => {
                    setConnectionId(c.id);
                    setPicked([]);
                  }}
                  className={`${CHIP} ${
                    connection?.id === c.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/70'
                  }`}
                >
                  {c.account} · {c.kind}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const created = addConnection(provider);
                  setConnectionId(created.id);
                  setPicked([]);
                }}
                className={ADD_CHIP}
              >
                <Plus className="h-3 w-3" />
                Add account
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {privateReposUsed + pickedPrivate} of {privateRepoLimit} private repositories used
            </p>
            <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {available.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Every repository this account can see is already connected.
                </li>
              )}
              {available.map((c) => (
                <li key={c.fullName} className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    id={`pick-${c.fullName}`}
                    checked={picked.includes(c.fullName)}
                    onChange={() => toggle(c.fullName)}
                    className="h-3.5 w-3.5 shrink-0 rounded border-border"
                  />
                  <label htmlFor={`pick-${c.fullName}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block truncate font-mono text-xs text-foreground">{c.fullName}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{c.about}</span>
                  </label>
                  <Capsule>{c.visibility}</Capsule>
                </li>
              ))}
            </ul>
            {overAllowance && (
              <p className="mt-2 text-[11px] text-destructive">
                That is more private repositories than the Team plan allows. Deselect one, or move to Enterprise.
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Context sources">
              <li className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  id="ctx-own-docs"
                  checked={ownDocs}
                  onChange={() => setOwnDocs((v) => !v)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-border"
                />
                <label htmlFor="ctx-own-docs" className="min-w-0 flex-1 cursor-pointer">
                  <span className="block truncate text-[13px] text-foreground">This repository’s own documentation</span>
                </label>
                <Capsule>{CONTEXT_SOURCE_KIND_LABEL.repository}</Capsule>
              </li>
              {(sources ?? []).map((source) => (
                <li key={source.id} className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    id={`ctx-bind-${source.id}`}
                    checked={contextPicked.includes(source.id)}
                    onChange={() =>
                      setContextPicked((prev) =>
                        prev.includes(source.id) ? prev.filter((id) => id !== source.id) : [...prev, source.id],
                      )
                    }
                    className="h-3.5 w-3.5 shrink-0 rounded border-border"
                  />
                  <label htmlFor={`ctx-bind-${source.id}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block truncate text-[13px] text-foreground">{source.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {source.docCount} document{source.docCount === 1 ? '' : 's'}
                    </span>
                  </label>
                  <Capsule>{CONTEXT_SOURCE_KIND_LABEL[source.kind]}</Capsule>
                </li>
              ))}
              {sources === null && (
                <li className="px-3 py-2 text-[11px] text-muted-foreground">Reading the workspace's sources</li>
              )}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              <Link to={`${PREVIEW_BASE}/context`} className="text-primary hover:underline">
                Add context
              </Link>{' '}
              to connect a source this workspace does not have yet.
            </p>
          </div>
        )}

        {step === 4 && (
          <div className="rounded-md border border-border px-3 py-2.5">
            <p className="text-xs text-foreground">
              {picked.length} repositor{picked.length === 1 ? 'y' : 'ies'} from{' '}
              {isGithub
                ? PROVIDER_NAME.github
                : connection
                  ? `${PROVIDER_NAME[connection.provider]} · ${connection.account}`
                  : 'the connection'}
              :
            </p>
            <ul className="mt-1.5 space-y-1">
              {picked.map((name) => (
                <li key={name} className="font-mono text-[11px] text-muted-foreground">
                  {name}
                  {linkErrors[name] && (
                    <span className="ml-2 font-sans text-destructive">{linkErrors[name]}</span>
                  )}
                </li>
              ))}
            </ul>
            {/* Only promise the scan when there is a provider to run it: with
                none, connecting writes the row and stops there. */}
            {isGithub && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {llmProvider === 'missing'
                  ? 'Connecting links the repository. No scan runs until an LLM provider is set in Settings.'
                  : 'Onboarding starts in the background as each repository is connected.'}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <button
              type="button"
              disabled={linking !== null}
              onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
              className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
            >
              Back
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              disabled={picked.length === 0 || overAllowance}
              onClick={() => setStep(3)}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Continue
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              onClick={() => setStep(4)}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Continue
            </button>
          )}
          {step === 4 && (
            <button
              type="button"
              disabled={linking !== null}
              onClick={() => {
                if (isGithub) {
                  void connectGithub();
                  return;
                }
                connectRepositories(picked);
                onOpenChange(false);
              }}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {linking === null
                ? 'Connect and start onboarding'
                : `Cloning ${linking + 1} of ${picked.length}`}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
