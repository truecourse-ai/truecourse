/**
 * Add context, in three steps that each fit one screen: the KIND, the
 * SCOPE (with a Check that lists what the scope would yield before anything is
 * stored), and the REPOSITORIES that should read it — none by default, so
 * adding a source never silently changes a corpus.
 *
 * STEP 1 IS THE INSTANCE, the same shape the connect-repository dialog uses:
 * the workspace's CONNECTED ACCOUNTS first (a tool this server can add and this
 * workspace has connected, named by the site it reads), then the two kinds that
 * need no account — a repository's own markdown, and a documentation site
 * through its llms.txt — the whole row being the button. Connecting a tool is
 * Settings' job, so the list ends with the one link that goes there, in an
 * edition that HAS tools.
 *
 * WHICH KINDS are offered is the server's answer (`addableKinds`), built from
 * the drivers it registered at boot: an edition without a tool's driver never
 * offers it, and a workspace that has not connected the account is sent to
 * Settings rather than into a scope it cannot read.
 *
 * THE REPOSITORY SCOPE reads the workspace's GitHub accounts and then the
 * repositories one of them can see, not the repositories Code has connected: a
 * source may read any repository the account reaches, and it syncs through that
 * account on its own. The account rides Check and Add. Which repositories READ
 * the source is Code's side: the connect dialog's Context step, a repository's
 * Context tab, the source page.
 *
 * ON A LOCAL SERVER there are no accounts and the repositories are the folders
 * this machine has connected: a path is not a thing this dialog can be handed,
 * it is a repository connected in Code, and the source reads it by copying the
 * folder exactly as a run does.
 *
 * Nothing is stored until Add and sync: Check runs the real driver against the
 * real scope and stores nothing, and the add closes on the new source's page,
 * which reads Syncing until its first sync lands.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GitBranch, Globe, Plug } from 'lucide-react';
import {
  CONTEXT_SOURCE_KIND_LABEL,
  DEFAULT_REPOSITORY_EXCLUDE,
  DEFAULT_REPOSITORY_INCLUDE,
  isContextConnectionProvider,
  type ContextConnectionView,
  type ContextSourceCheck,
  type ContextSourceKind,
  type ContextSourceView,
  type GithubInstallableRepo,
  type GithubInstallationSummary,
  type RepositorySourceConfig,
} from '@truecourse/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { addContextSource, listContextConnections, previewContextSource } from '@/lib/api';
import { fetchGithubStatus, fetchInstallationRepos } from '@/dashboard/data/real-repos';
import { fetchLocalRepos } from '@/dashboard/providers/local-folder';
import { useServerMode } from '@/contexts/CapabilityContext';
import { registeredSettingsTabs } from '@/dashboard/shell/registry';
import { Stepper } from '@/dashboard/ui/stepper';
import { sourceHref } from './context-hrefs';

const FOOT_BUTTON = 'rounded px-3 py-1.5 text-xs font-medium';

/** The dialog's three steps, named rather than numbered. */
const STEPS = ['Source', 'Scope'] as const;

/** A kind this dialog can walk somebody through. The server says which. */
type AddableKind = ContextSourceKind;

/** What Check does, in the words of the kind it would run against. */
const CHECK_WORDS: Partial<Record<AddableKind, string>> = {
  repository:
    'Check walks the branch with these patterns and counts the files it would keep; nothing is stored yet.',
  site: 'Check reads the llms.txt and counts the pages it lists; nothing is stored yet.',
  jira: 'Check runs this search and counts the issues it would keep; nothing is stored yet.',
  confluence: 'Check lists the space and counts the pages it would keep; nothing is stored yet.',
};

/** What a yield counts, in the same words. */
const YIELD_NOUN: Partial<Record<AddableKind, { one: string; many: string }>> = {
  repository: { one: 'file', many: 'files' },
  site: { one: 'page', many: 'pages' },
  jira: { one: 'issue', many: 'issues' },
  confluence: { one: 'page', many: 'pages' },
};

/** The fallback for a kind with no noun of its own. */
const DOCUMENT_NOUN = { one: 'document', many: 'documents' };

/**
 * The kinds that need no connected account, in the order the dialog offers
 * them, under the tool accounts the workspace HAS connected. The name of a kind
 * is the shared one ({@link CONTEXT_SOURCE_KIND_LABEL}), so the dialog and the
 * Sources list call the same thing by the same word. A tool nothing connected
 * is not a row: it is the link to Settings › Connections — a section this
 * edition may not have, and then there is nothing to point at.
 */
const KINDS: { kind: AddableKind; about: string }[] = [
  { kind: 'repository', about: "A repository's own markdown, by path patterns" },
  { kind: 'site', about: 'A public documentation site, through its llms.txt' },
];

/** The globs a pattern field holds, one per line — the shape the route takes. */
const linesOf = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function AddContextDialog({
  open,
  onOpenChange,
  initialKind = null,
  sources,
  addableKinds = [],
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open straight on this kind's scope step (the install's return does). */
  initialKind?: AddableKind | null;
  /** The workspace's sources, so the dialog can say a repository already has one. */
  sources: ContextSourceView[] | null;
  /** The kinds the SERVER can add — the drivers it registered at boot. */
  addableKinds?: ContextSourceKind[];
  /** Re-read the page behind the dialog once the source is stored. */
  onAdded?: () => void;
}) {
  const navigate = useNavigate();
  // Where a tool is connected. An edition without that section has no tools, so
  // the list ends at the two kinds rather than pointing at a place that is not there.
  const hasConnections = registeredSettingsTabs().some((tab) => tab.id === 'connections');
  // A local server has no accounts: its repositories are the folders on this
  // machine, which is what the repository scope offers there.
  const local = useServerMode() === 'local';

  const [kind, setKind] = useState<AddableKind | null>(null);
  const [installations, setInstallations] = useState<GithubInstallationSummary[] | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  /** The chosen account's repositories; null while they are being read. */
  const [accountRepos, setAccountRepos] = useState<GithubInstallableRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [repoScope, setRepoScope] = useState<string | null>(null);
  const [include, setInclude] = useState(DEFAULT_REPOSITORY_INCLUDE.join('\n'));
  const [exclude, setExclude] = useState(DEFAULT_REPOSITORY_EXCLUDE.join('\n'));
  const [url, setUrl] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [jql, setJql] = useState('');
  const [spaceKey, setSpaceKey] = useState('');
  /** The workspace's tool accounts; null while they are being read. */
  const [connections, setConnections] = useState<ContextConnectionView[] | null>(null);
  const [checked, setChecked] = useState<ContextSourceCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialKind) setKind(initialKind);
      return;
    }
    setKind(null);
    setInstallations(null);
    setAccountId(null);
    setAccountRepos(null);
    setReposError(null);
    setRepoScope(null);
    setInclude(DEFAULT_REPOSITORY_INCLUDE.join('\n'));
    setExclude(DEFAULT_REPOSITORY_EXCLUDE.join('\n'));
    setUrl('');
    setProjectKey('');
    setJql('');
    setSpaceKey('');
    setChecked(null);
    setChecking(false);
    setFailure(null);
    setAdding(false);
  }, [open, initialKind]);

  // The tool accounts this workspace has connected, read when the dialog opens
  // and only where a tool can be added at all: the route belongs to the edition
  // that has Connections, and the server's `addableKinds` is what says so.
  const tools = addableKinds.filter(isContextConnectionProvider);
  useEffect(() => {
    if (!open || tools.length === 0) return;
    let live = true;
    void listContextConnections()
      .then((answer) => {
        if (live) setConnections(answer.connections);
      })
      .catch(() => {
        // A workspace whose connections cannot be read has none to offer; the
        // link to Settings below is still the way in.
        if (live) setConnections([]);
      });
    return () => {
      live = false;
    };
  }, [open, tools.length]);

  // The accounts a Repository source can read through, read on entering the
  // scope step: a source may read any repository they can reach, connected in
  // Code or not. With no account there is nothing to pick and the step says so.
  // A local server has none — its repositories are the folders it connected —
  // so those are read instead, and there is no account to choose.
  useEffect(() => {
    if (kind !== 'repository' || installations !== null) return;
    if (local) {
      let alive = true;
      void fetchLocalRepos()
        .then((folders) => {
          if (!alive) return;
          setInstallations([]);
          setAccountRepos(
            folders.map((folder) => ({
              fullName: folder.repoFullName,
              defaultBranch: '',
              private: true,
              connectedElsewhere: false,
            })),
          );
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setInstallations([]);
          setAccountRepos([]);
          setReposError(e instanceof Error ? e.message : String(e));
        });
      return () => {
        alive = false;
      };
    }
    let live = true;
    void fetchGithubStatus()
      .then((status) => {
        if (!live) return;
        setInstallations(status.installations);
        if (status.installations.length > 0) {
          setAccountId(status.installations[0]!.installationId);
        }
      })
      .catch((e: unknown) => {
        if (!live) return;
        setInstallations([]);
        setReposError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [kind, installations, local]);

  // What the chosen account can see.
  useEffect(() => {
    if (accountId === null) return;
    let live = true;
    setAccountRepos(null);
    setReposError(null);
    void fetchInstallationRepos(accountId)
      .then((found) => {
        if (live) setAccountRepos(found);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setAccountRepos([]);
        setReposError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [accountId]);


  /** The Repository source a repository already has, if it has one. */
  const existingFor = (repoFullName: string) =>
    (sources ?? []).find(
      (source) =>
        source.kind === 'repository' &&
        (source.config as Partial<RepositorySourceConfig>).repoFullName === repoFullName,
    );

  const accounts = installations ?? [];
  const already = repoScope ? existingFor(repoScope) : undefined;
  /** Nothing to read from: no GitHub account hosted, no folder connected locally. */
  const nothingToReadFrom = local
    ? accountRepos !== null && accountRepos.length === 0
    : installations !== null && accounts.length === 0;

  const config = (): Record<string, unknown> => {
    if (kind === 'repository') {
      return {
        repoFullName: repoScope ?? '',
        include: linesOf(include),
        exclude: linesOf(exclude),
      };
    }
    if (kind === 'jira') return { projectKey: projectKey.trim(), jql: jql.trim() };
    if (kind === 'confluence') return { spaceKey: spaceKey.trim() };
    return { llmsTxtUrl: url.trim() };
  };

  /** The account a repository source reads through, sent with every call. */
  const account = (): { installationId?: number } =>
    kind === 'repository' && accountId !== null ? { installationId: accountId } : {};

  const scopeReady =
    kind === 'repository'
      ? Boolean(repoScope) && !already
      : kind === 'jira'
        ? projectKey.trim() !== ''
        : kind === 'confluence'
          ? spaceKey.trim() !== ''
          : url.trim() !== '';

  const step: 1 | 2 = !kind ? 1 : 2;

  const runCheck = (): void => {
    if (!kind) return;
    setChecking(true);
    setFailure(null);
    void previewContextSource({ kind, config: config(), ...account() })
      .then(setChecked)
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)))
      .finally(() => setChecking(false));
  };

  const add = (): void => {
    if (!kind) return;
    setAdding(true);
    setFailure(null);
    void addContextSource({ kind, config: config(), repoIds: [], ...account() })
      .then((res) => {
        onAdded?.();
        onOpenChange(false);
        navigate(sourceHref(res.source.id));
      })
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)))
      .finally(() => setAdding(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add context</DialogTitle>
          <DialogDescription>
            <Stepper steps={STEPS} current={step - 1} />
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <ul className="min-w-0 divide-y divide-border rounded-md border border-border" aria-label="Kinds of source">
            {(connections ?? [])
              .filter((connection) => connection.connected && tools.includes(connection.provider))
              .map((connection) => (
                <li key={connection.provider}>
                  <button
                    type="button"
                    onClick={() => {
                      setKind(connection.provider);
                      setChecked(null);
                      setFailure(null);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                      <Plug className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-foreground">
                        {CONTEXT_SOURCE_KIND_LABEL[connection.provider]}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {connection.baseUrl}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            {KINDS.map((row) => (
              <li key={row.kind}>
                <button
                  type="button"
                  onClick={() => {
                    setKind(row.kind);
                    setChecked(null);
                    setFailure(null);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                    {row.kind === 'repository' ? (
                      <GitBranch className="h-4 w-4" aria-hidden />
                    ) : (
                      <Globe className="h-4 w-4" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">
                      {CONTEXT_SOURCE_KIND_LABEL[row.kind]}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">{row.about}</span>
                  </span>
                </button>
              </li>
            ))}
            {hasConnections && (
              <li>
                <Link
                  to={'/settings/connections'}
                  onClick={() => onOpenChange(false)}
                  className="block px-3 py-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                >
                  {(connections ?? []).some((connection) => connection.connected)
                    ? 'Connect another tool in Settings'
                    : 'Connect a tool in Settings'}
                </Link>
              </li>
            )}
          </ul>
        )}

        {step >= 2 && kind === 'repository' && (
          <div className="space-y-3">
            {nothingToReadFrom ? (
              <div>
                <p className="text-[11px] text-muted-foreground">
                  {local ? 'No folder connected yet.' : 'No GitHub account connected yet.'}
                </p>
                <Link
                  to={local ? '/code?connect=1' : '/settings/repositories?from=context-add'}
                  onClick={() => onOpenChange(false)}
                  className="mt-1 inline-block text-[11px] text-primary hover:underline"
                >
                  {local ? 'Connect a folder in Code' : 'Connect an account in Settings'}
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {!local && accounts.length > 1 && (
                  <div>
                    <label
                      className="text-[11px] font-medium text-muted-foreground"
                      htmlFor="ctx-account"
                    >
                      Account
                    </label>
                    <select
                      id="ctx-account"
                      value={accountId ?? ''}
                      onChange={(e) => {
                        setAccountId(e.target.value ? Number(e.target.value) : null);
                        setRepoScope(null);
                        setChecked(null);
                      }}
                      className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {accounts.map((installation) => (
                        <option
                          key={installation.installationId}
                          value={installation.installationId}
                        >
                          {installation.accountLogin || `#${installation.installationId}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground" htmlFor="ctx-repo">
                    Repository
                  </label>
                  <select
                    id="ctx-repo"
                    value={repoScope ?? ''}
                    onChange={(e) => {
                      setRepoScope(e.target.value || null);
                      setChecked(null);
                    }}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">
                      {accountRepos === null ? 'Reading repositories' : 'Pick a repository'}
                    </option>
                    {(accountRepos ?? []).map((repo) => {
                      const has = existingFor(repo.fullName);
                      return (
                        <option key={repo.fullName} value={repo.fullName} disabled={Boolean(has)}>
                          {repo.fullName}
                          {has ? ' · already a source' : ''}
                        </option>
                      );
                    })}
                  </select>
                  {reposError && <p className="mt-1 text-[11px] text-destructive">{reposError}</p>}
                  <Link
                    to={local ? '/code?connect=1' : '/settings/repositories?from=context-add'}
                    onClick={() => onOpenChange(false)}
                    className="mt-1 inline-block text-[11px] text-primary hover:underline"
                  >
                    {local ? 'Connect another folder in Code' : 'Connect another account in Settings'}
                  </Link>
                </div>
              </div>
            )}
            {nothingToReadFrom ? null : already ? (
              <p className="text-[11px] text-muted-foreground">
                {repoScope} already has a source, “{already.title}”. Edit its patterns
                there rather than adding a second one.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground" htmlFor="ctx-include">
                    Include
                  </label>
                  <textarea
                    id="ctx-include"
                    rows={3}
                    value={include}
                    onChange={(e) => {
                      setInclude(e.target.value);
                      setChecked(null);
                    }}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground" htmlFor="ctx-exclude">
                    Exclude
                  </label>
                  <textarea
                    id="ctx-exclude"
                    rows={3}
                    value={exclude}
                    onChange={(e) => {
                      setExclude(e.target.value);
                      setChecked(null);
                    }}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {step >= 2 && kind === 'jira' && (
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground" htmlFor="ctx-project">
                Project key
              </label>
              <input
                id="ctx-project"
                value={projectKey}
                onChange={(e) => {
                  setProjectKey(e.target.value);
                  setChecked(null);
                }}
                placeholder="ENG"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground" htmlFor="ctx-jql">
                JQL filter
              </label>
              <input
                id="ctx-jql"
                value={jql}
                onChange={(e) => {
                  setJql(e.target.value);
                  setChecked(null);
                }}
                placeholder="issuetype in standardIssueTypes()"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Narrows the project. Left blank, every standard issue type is read.
              </p>
            </div>
          </div>
        )}

        {step >= 2 && kind === 'confluence' && (
          <div>
            <label className="text-[11px] font-medium text-muted-foreground" htmlFor="ctx-space">
              Space key
            </label>
            <input
              id="ctx-space"
              value={spaceKey}
              onChange={(e) => {
                setSpaceKey(e.target.value);
                setChecked(null);
              }}
              placeholder="ENG"
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        {step >= 2 && kind === 'site' && (
          <div>
            <label className="text-[11px] font-medium text-muted-foreground" htmlFor="ctx-url">
              llms.txt URL
            </label>
            <input
              id="ctx-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setChecked(null);
              }}
              placeholder="https://docs.example.com/llms.txt"
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        {step >= 2 && kind && (
          <>
            {checked ? (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="text-xs text-foreground">
                  {checked.title} yields {checked.count}{' '}
                  {checked.count === 1
                    ? (YIELD_NOUN[kind] ?? DOCUMENT_NOUN).one
                    : (YIELD_NOUN[kind] ?? DOCUMENT_NOUN).many}
                  {checked.titles.length > 0 ? '. The first few:' : '.'}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {checked.titles.map((title) => (
                    <li key={title} className="truncate text-[11px] text-muted-foreground">
                      {title}
                    </li>
                  ))}
                </ul>
              </div>
            ) : kind === 'repository' && installations !== null && accounts.length === 0 ? null : (
              <p className="text-[11px] text-muted-foreground">{CHECK_WORDS[kind]}</p>
            )}
            {failure && <p className="text-[11px] text-destructive">{failure}</p>}
          </>
        )}

        <DialogFooter>
          {step > 1 && (
            <button
              type="button"
              onClick={() => setKind(null)}
              className={`${FOOT_BUTTON} border border-border text-foreground hover:bg-muted/60`}
            >
              Back
            </button>
          )}
          {step === 2 && !checked && (
            <button
              type="button"
              disabled={!scopeReady || checking}
              onClick={runCheck}
              className={`${FOOT_BUTTON} bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50`}
            >
              {checking ? 'Checking…' : 'Check'}
            </button>
          )}
          {step === 2 && checked && (
            <button
              type="button"
              disabled={adding}
              onClick={add}
              className={`${FOOT_BUTTON} bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50`}
            >
              {adding ? 'Adding…' : 'Add and sync'}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
