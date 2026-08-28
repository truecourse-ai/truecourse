// PREVIEW: the GitHub path here is REAL (it links through the App and clones on
// the server); GitLab and Azure beside it are mocks.

/**
 * Connect a repository: pick a provider (a provider with nothing connected
 * authorizes first), pick the account and the repositories it can see, confirm.
 * The repository then appears on Home with its onboarding chain in flight.
 * Opened from Home.
 *
 * GITHUB IS THE REAL ONE. The row reads `/api/github/status`: the App's
 * installations on this workspace and the repositories already linked. An
 * installation lists what it can see; connecting posts one repository at a time
 * to `/api/github/repos/link`, and the server clones inside that request — hence
 * the pending button and the per-repository outcome, and hence a failure that
 * leaves the dialog standing rather than swallowing the rest of the batch.
 * Installing the App is a top-level navigation to GitHub; its setup redirect
 * lands back on `/preview?connect=1`, so a new installation is pickable at once.
 *
 * GitLab and Azure are still the fixture flow: authorize, pick, confirm, and the
 * rows they add are mock rows.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Capsule, ProviderIcon, PROVIDER_NAME } from '@/preview/ui/bits';
import type { GithubInstallableRepo, GithubInstallationSummary } from '@truecourse/shared';
import type { ProviderId } from '@/preview/data/types';
import {
  fetchGithubStatus,
  fetchInstallationRepos,
  linkGithubRepo,
} from '@/preview/data/real-repos';
import { usePreviewState } from '@/preview/shell/preview-state';

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
  } = usePreviewState();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [provider, setProvider] = useState<ProviderId>('github');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
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
    }
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
   * The real one: one link request per repository, in order, each cloning on the
   * server before it answers. A refusal is kept against its repository and the
   * batch carries on; the dialog only closes when every one landed. What did
   * land drops out of the selection, so a retry never re-clones it.
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
    setLinking(null);
    setLinkErrors(failures);
    setPicked((prev) => prev.filter((name) => failures[name]));
    // Whatever landed is a real repository now, failures beside it or not.
    await refreshRealRepos();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a repository</DialogTitle>
          <DialogDescription>
            Step {step} of 3 ·{' '}
            {step === 1 ? 'pick a provider' : step === 2 ? 'pick repositories' : 'confirm and start onboarding'}
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
            {isGithub && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Each repository is cloned as it is connected, which takes a few minutes.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <button
              type="button"
              disabled={linking !== null}
              onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
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
