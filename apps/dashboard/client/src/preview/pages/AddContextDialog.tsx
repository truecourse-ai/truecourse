// PREVIEW: REAL. Adding a source to the workspace's context.

/**
 * Add context, in three steps that each fit one screen (plan §5): the KIND, the
 * SCOPE (with a Check that lists what the scope would yield before anything is
 * stored), and the REPOSITORIES that should read it — none by default, so
 * adding a source never silently changes a corpus.
 *
 * Two kinds work: a repository's own markdown, and a documentation site through
 * its llms.txt. The six tool kinds are LISTED and locked with "Coming soon" —
 * hiding them would make the dialog lie about what the product is for, and
 * offering them would make it lie about what it does.
 *
 * Nothing is stored until Add and sync: Check runs the real driver against the
 * real scope and stores nothing, and the add closes on the Documents view
 * narrowed to the new source, which reads Syncing until its first sync lands.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch, Globe, Lock } from 'lucide-react';
import {
  CONTEXT_SOURCE_KIND_LABEL,
  DEFAULT_REPOSITORY_EXCLUDE,
  DEFAULT_REPOSITORY_INCLUDE,
  type ContextSourceCheck,
  type ContextSourceKind,
  type ContextSourceView,
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
import { ConnectorLogo, type ConnectorTool } from '@/preview/ui/connector-logos';
import { usePreviewState } from '@/preview/shell/preview-state';
import { documentsHref } from './context-hrefs';

const FOOT_BUTTON = 'rounded px-3 py-1.5 text-xs font-medium';

type AddableKind = 'repository' | 'site';

/**
 * Every kind the dialog offers, in the order it offers them. The name of a kind
 * is the shared one ({@link CONTEXT_SOURCE_KIND_LABEL}), so the dialog and the
 * Sources list call the same thing by the same word.
 */
const KINDS: {
  kind: ContextSourceKind;
  about: string;
  tool?: ConnectorTool;
}[] = [
  { kind: 'repository', about: "A repository's own markdown, by path patterns" },
  { kind: 'site', about: 'A public documentation site, through its llms.txt' },
  { kind: 'jira', about: "A project's issues", tool: 'jira' },
  { kind: 'confluence', about: 'A space, optionally under one root page', tool: 'confluence' },
  { kind: 'google-drive', about: 'A folder, recursive', tool: 'gdrive' },
  { kind: 'onedrive', about: 'A folder, recursive', tool: 'onedrive' },
  { kind: 'notion', about: 'The pages under a page or a database', tool: 'notion' },
  { kind: 'slack', about: "A channel's canvases and pinned messages", tool: 'slack' },
];

const isAddable = (kind: ContextSourceKind): kind is AddableKind =>
  kind === 'repository' || kind === 'site';

/** The globs a pattern field holds, one per line — the shape the route takes. */
const linesOf = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function AddContextDialog({
  open,
  onOpenChange,
  sources,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The workspace's sources, so the dialog can say a repository already has one. */
  sources: ContextSourceView[] | null;
  /** Re-read the page behind the dialog once the source is stored. */
  onAdded?: () => void;
}) {
  const navigate = useNavigate();
  const { repos } = usePreviewState();

  const [kind, setKind] = useState<AddableKind | null>(null);
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
    if (open) return;
    setKind(null);
    setRepoScope(null);
    setInclude(DEFAULT_REPOSITORY_INCLUDE.join('\n'));
    setExclude(DEFAULT_REPOSITORY_EXCLUDE.join('\n'));
    setUrl('');
    setChecked(null);
    setChecking(false);
    setFailure(null);
    setPicked([]);
    setAdding(false);
  }, [open]);

  // Only a connected repository can be a source: a fixture has no tree to walk.
  const connected = useMemo(() => repos.filter((repo) => repo.real), [repos]);

  /** The Repository source a repository already has, if it has one. */
  const existingFor = (repoFullName: string) =>
    (sources ?? []).find(
      (source) =>
        source.kind === 'repository' &&
        (source.config as Partial<RepositorySourceConfig>).repoFullName === repoFullName,
    );

  const chosenRepo = connected.find((repo) => repo.id === repoScope);
  const already = chosenRepo ? existingFor(chosenRepo.fullName) : undefined;

  const config = (): Record<string, unknown> =>
    kind === 'repository'
      ? {
          repoFullName: chosenRepo?.fullName ?? '',
          include: linesOf(include),
          exclude: linesOf(exclude),
        }
      : { llmsTxtUrl: url.trim() };

  const scopeReady =
    kind === 'repository' ? Boolean(chosenRepo) && !already : url.trim() !== '';

  const step: 1 | 2 | 3 = !kind ? 1 : !checked ? 2 : 3;
  const stepWords =
    step === 1
      ? 'pick the kind'
      : step === 2
        ? 'set the scope, then check it'
        : 'pick the repositories that read it';

  const runCheck = (): void => {
    if (!kind) return;
    setChecking(true);
    setFailure(null);
    void previewContextSource({ kind, config: config() })
      .then(setChecked)
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)))
      .finally(() => setChecking(false));
  };

  const add = (): void => {
    if (!kind) return;
    setAdding(true);
    setFailure(null);
    void addContextSource({ kind, config: config(), repoIds: picked })
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
          <DialogDescription>{`Step ${step} of 3 · ${stepWords}`}</DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <ul className="min-w-0 divide-y divide-border rounded-md border border-border" aria-label="Kinds of source">
            {KINDS.map((row) => {
              const locked = !isAddable(row.kind);
              return (
                <li key={row.kind}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      if (!isAddable(row.kind)) return;
                      setKind(row.kind);
                      setChecked(null);
                      setFailure(null);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors enabled:hover:bg-muted/40 disabled:cursor-default"
                  >
                    {row.tool ? (
                      <ConnectorLogo tool={row.tool} className="h-5 w-5 shrink-0" />
                    ) : (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                        {row.kind === 'repository' ? (
                          <GitBranch className="h-4 w-4" aria-hidden />
                        ) : (
                          <Globe className="h-4 w-4" aria-hidden />
                        )}
                      </span>
                    )}
                    <span className={`min-w-0 flex-1 ${locked ? 'opacity-50' : ''}`}>
                      <span className="block truncate text-[13px] text-foreground">
                        {CONTEXT_SOURCE_KIND_LABEL[row.kind]}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">{row.about}</span>
                    </span>
                    {locked && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                        <Lock className="h-3 w-3" aria-hidden />
                        Coming soon
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {step >= 2 && kind === 'repository' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Repository</span>
              {connected.map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  aria-pressed={repoScope === repo.id}
                  onClick={() => {
                    setRepoScope(repo.id);
                    setChecked(null);
                  }}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    repoScope === repo.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/70'
                  }`}
                >
                  {repo.fullName}
                </button>
              ))}
              {connected.length === 0 && (
                <span className="text-[11px] text-muted-foreground">
                  No repository is connected yet.
                </span>
              )}
            </div>
            {already ? (
              <p className="text-[11px] text-muted-foreground">
                {chosenRepo?.fullName} already has a source, “{already.title}”. Edit its patterns
                there rather than adding a second one.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
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
                  {checked.title} yields {checked.count} document{checked.count === 1 ? '' : 's'}
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
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Check lists what this scope would yield before anything is stored.
              </p>
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
                  No repository is connected yet.
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
