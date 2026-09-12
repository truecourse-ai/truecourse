/**
 * Add context, in three steps that each fit one screen (plan §5): the KIND, the
 * SCOPE (with a Check that lists what the scope would yield before anything is
 * stored), and the REPOSITORIES that should read it — none by default, so
 * adding a source never silently changes a corpus.
 *
 * STEP 1 IS THE INSTANCE, the same shape the connect-repository dialog uses:
 * the connected accounts of the tool connectors first (there are none to
 * connect yet, so none render), then the two kinds that need no account — a
 * repository's own markdown, and a documentation site through its llms.txt —
 * the whole row being the button. Connecting a tool is Settings' job, so the
 * list ends with the one link that goes there.
 *
 * THE REPOSITORY SCOPE reads the workspace's GitHub accounts and then the
 * repositories one of them can see, not the repositories Code has connected: a
 * source may read any repository the account reaches, and it syncs through that
 * account on its own. The account rides Check and Add, and the Link step is
 * about the connected repositories that will READ the source, which may be none.
 *
 * Nothing is stored until Add and sync: Check runs the real driver against the
 * real scope and stores nothing, and the add closes on the Documents view
 * narrowed to the new source, which reads Syncing until its first sync lands.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GitBranch, Globe } from 'lucide-react';
import {
  CONTEXT_SOURCE_KIND_LABEL,
  DEFAULT_REPOSITORY_EXCLUDE,
  DEFAULT_REPOSITORY_INCLUDE,
  type ContextSourceCheck,
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
import { addContextSource, previewContextSource } from '@/lib/api';
import { fetchGithubStatus, fetchInstallationRepos } from '@/preview/data/real-repos';
import { usePreviewState } from '@/preview/shell/preview-state';
import { Stepper } from '@/preview/ui/stepper';
import { PREVIEW_BASE } from '@/preview/shell/base';
import { documentsHref } from './context-hrefs';

const FOOT_BUTTON = 'rounded px-3 py-1.5 text-xs font-medium';

/** The dialog's three steps, named rather than numbered. */
const STEPS = ['Source', 'Scope', 'Link'] as const;

type AddableKind = 'repository' | 'site';

/** What Check does, in the words of the kind it would run against. */
const CHECK_WORDS: Record<AddableKind, string> = {
  repository:
    'Check walks the branch with these patterns and counts the files it would keep; nothing is stored yet.',
  site: 'Check reads the llms.txt and counts the pages it lists; nothing is stored yet.',
};

/** What a yield counts, in the same words. */
const YIELD_NOUN: Record<AddableKind, { one: string; many: string }> = {
  repository: { one: 'file', many: 'files' },
  site: { one: 'page', many: 'pages' },
};

/**
 * The kinds that need no connected account, in the order the dialog offers
 * them. The name of a kind is the shared one ({@link CONTEXT_SOURCE_KIND_LABEL}),
 * so the dialog and the Sources list call the same thing by the same word. The
 * tool kinds are named on Settings › Connections, where they are connected.
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
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open straight on this kind's scope step (the install's return does). */
  initialKind?: AddableKind | null;
  /** The workspace's sources, so the dialog can say a repository already has one. */
  sources: ContextSourceView[] | null;
  /** Re-read the page behind the dialog once the source is stored. */
  onAdded?: () => void;
}) {
  const navigate = useNavigate();
  const { repos } = usePreviewState();

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
  const [checked, setChecked] = useState<ContextSourceCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
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
    setChecked(null);
    setChecking(false);
    setFailure(null);
    setPicked([]);
    setAdding(false);
  }, [open, initialKind]);

  // The accounts a Repository source can read through, read on entering the
  // scope step: a source may read any repository they can reach, connected in
  // Code or not. With no account there is nothing to pick and the step says so.
  useEffect(() => {
    if (kind !== 'repository' || installations !== null) return;
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
  }, [kind, installations]);

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

  // The repositories that could READ a source: the ones Code has connected.
  const connected = repos;

  /** The Repository source a repository already has, if it has one. */
  const existingFor = (repoFullName: string) =>
    (sources ?? []).find(
      (source) =>
        source.kind === 'repository' &&
        (source.config as Partial<RepositorySourceConfig>).repoFullName === repoFullName,
    );

  const accounts = installations ?? [];
  const already = repoScope ? existingFor(repoScope) : undefined;

  const config = (): Record<string, unknown> =>
    kind === 'repository'
      ? {
          repoFullName: repoScope ?? '',
          include: linesOf(include),
          exclude: linesOf(exclude),
        }
      : { llmsTxtUrl: url.trim() };

  /** The account a repository source reads through, sent with every call. */
  const account = (): { installationId?: number } =>
    kind === 'repository' && accountId !== null ? { installationId: accountId } : {};

  const scopeReady =
    kind === 'repository' ? Boolean(repoScope) && !already : url.trim() !== '';

  const step: 1 | 2 | 3 = !kind ? 1 : !checked ? 2 : 3;

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
    void addContextSource({ kind, config: config(), repoIds: picked, ...account() })
      .then((res) => {
        onAdded?.();
        onOpenChange(false);
        navigate(documentsHref({ source: res.source.id }));
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
            <li>
              <Link
                to={`${PREVIEW_BASE}/settings/connections`}
                onClick={() => onOpenChange(false)}
                className="block px-3 py-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              >
                Connect another tool in Settings
              </Link>
            </li>
          </ul>
        )}

        {step >= 2 && kind === 'repository' && (
          <div className="space-y-3">
            {installations !== null && accounts.length === 0 ? (
              <div>
                <p className="text-[11px] text-muted-foreground">No GitHub account connected yet.</p>
                <Link
                  to={`${PREVIEW_BASE}/settings/repositories?from=context-add`}
                  onClick={() => onOpenChange(false)}
                  className="mt-1 inline-block text-[11px] text-primary hover:underline"
                >
                  Connect an account in Settings
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {accounts.length > 1 && (
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
                    to={`${PREVIEW_BASE}/settings/repositories?from=context-add`}
                    onClick={() => onOpenChange(false)}
                    className="mt-1 inline-block text-[11px] text-primary hover:underline"
                  >
                    Connect another account in Settings
                  </Link>
                </div>
              </div>
            )}
            {installations !== null && accounts.length === 0 ? null : already ? (
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
                  {checked.count === 1 ? YIELD_NOUN[kind].one : YIELD_NOUN[kind].many}
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

        {step === 3 && (
          <div>
            <p className="text-[11px] text-muted-foreground">
              Which repositories should read this source? None is fine — a source can be linked
              later from a repository’s Context tab.
            </p>
            <ul className="mt-2 max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {connected.map((repo) => (
                <li key={repo.id} className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    id={`ctx-read-${repo.id}`}
                    checked={picked.includes(repo.id)}
                    onChange={() =>
                      setPicked((prev) =>
                        prev.includes(repo.id)
                          ? prev.filter((id) => id !== repo.id)
                          : [...prev, repo.id],
                      )
                    }
                    className="h-3.5 w-3.5 shrink-0 rounded border-border"
                  />
                  <label htmlFor={`ctx-read-${repo.id}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block truncate font-mono text-xs text-foreground">
                      {repo.fullName}
                    </span>
                  </label>
                </li>
              ))}
              {connected.length === 0 && (
                <li className="px-3 py-2 text-[11px] text-muted-foreground">
                  No repository reads it yet. Link one from the source page once it is connected.
                </li>
              )}
            </ul>
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <button
              type="button"
              onClick={() => {
                if (step === 3) setChecked(null);
                else setKind(null);
              }}
              className={`${FOOT_BUTTON} border border-border text-foreground hover:bg-muted/60`}
            >
              Back
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              disabled={!scopeReady || checking}
              onClick={runCheck}
              className={`${FOOT_BUTTON} bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50`}
            >
              {checking ? 'Checking…' : 'Check'}
            </button>
          )}
          {step === 3 && (
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
