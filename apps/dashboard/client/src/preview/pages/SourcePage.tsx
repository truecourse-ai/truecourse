/**
 * Context › Sources › <source>: the page a source row opens, and the only
 * place a source can be acted on.
 *
 * Three blocks, each a plain section: the SCOPE it reads (editable, per kind),
 * who READS it (every connected repository with its Linked switch), and its
 * SYNCS (newest first, with the source's own failure note above them). The
 * documents it yielded are the Documents view narrowed to it, one link away.
 *
 * The header carries what can be DONE to the source — Sync now, Pause / Resume
 * and, for a site, Remove — beside its status word. A repository source is
 * removed by disconnecting its repository, so it is not offered.
 *
 * Every word here is the server's: the scope fields show the stored config, the
 * syncs are stored records, a refusal is the server's message in a toast, and a
 * save that started no sync says what the server said about why.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type {
  ContextSourceView,
  ContextSyncRecord,
  RepositorySourceConfig,
  SiteSourceConfig,
} from '@truecourse/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getRepoContextBindings,
  pauseContextSource,
  putRepoContextBindings,
  removeContextSource,
  syncContextSource,
  updateContextSourceConfig,
} from '@/lib/api';
import { SectionTitle } from '@/preview/ui/bits';
import { CONTEXT_SYNC_TONE, CONTEXT_SYNC_WORD, StatusWord } from '@/preview/ui/status-word';
import { formatRelativeTime } from '@/preview/vendor/shared/format/relative-time';
import { usePreviewState } from '@/preview/shell/preview-state';
import { useContextSignal, useContextSource } from '@/preview/shell/use-context';
import type { Repo } from '@/preview/data/types';
import { ContextFrame } from './ContextFrame';
import { CONTEXT_BASE, documentsHref } from './context-hrefs';

const ACTION =
  'rounded border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50';
const FIELD =
  'w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
const LABEL = 'text-[11px] font-medium text-muted-foreground';

/** The scope as a form: one field per thing a reader can change. */
interface ScopeForm {
  branch: string;
  include: string;
  exclude: string;
  url: string;
}

/** The globs a pattern field holds, one per line — the shape the route takes. */
const linesOf = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** The stored config, as the form shows it. Nothing is filled in that is not stored. */
function formOf(source: ContextSourceView): ScopeForm {
  const repo = source.config as Partial<RepositorySourceConfig>;
  const site = source.config as Partial<SiteSourceConfig>;
  return {
    branch: typeof repo.branch === 'string' ? repo.branch : '',
    include: (repo.include ?? []).join('\n'),
    exclude: (repo.exclude ?? []).join('\n'),
    url: typeof site.llmsTxtUrl === 'string' ? site.llmsTxtUrl : '',
  };
}

/** The config a save sends: the form, in the shape the route validates. */
function scopeOf(source: ContextSourceView, form: ScopeForm): Record<string, unknown> {
  if (source.kind !== 'repository') return { llmsTxtUrl: form.url.trim() };
  return {
    repoFullName: (source.config as Partial<RepositorySourceConfig>).repoFullName ?? '',
    branch: form.branch.trim(),
    include: linesOf(form.include),
    exclude: linesOf(form.exclude),
  };
}

/** The `owner/repo` a repository source scopes, which is always one of its readers. */
const ownRepoOf = (source: ContextSourceView): string | null =>
  source.kind === 'repository'
    ? ((source.config as Partial<RepositorySourceConfig>).repoFullName ?? null)
    : null;

/** One Linked switch, the idiom the repository's Context tab uses. */
function LinkSwitch({
  label,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-background transition-[left] ${
          checked ? 'left-3.5' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export default function SourcePage({ sourceId }: { sourceId: string }) {
  const navigate = useNavigate();
  const signal = useContextSignal();
  const { source, syncs, error, refetch } = useContextSource(sourceId, signal);
  const { repos } = usePreviewState();

  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** A link being saved, ahead of the read that confirms it. */
  const [pending, setPending] = useState<Record<string, boolean>>({});
  /** What the reader has typed, or null while the fields still show the stored scope. */
  const [form, setForm] = useState<ScopeForm | null>(null);
  /** The stored scope the fields last followed, so a re-read never eats typing. */
  const [base, setBase] = useState<string>('');

  const stored = useMemo(() => (source ? formOf(source) : null), [source]);

  // A scope the server changed (this page's own save included) takes the
  // fields back: what is on screen is always a scope somebody asked for.
  useEffect(() => {
    if (!stored) return;
    const key = JSON.stringify(stored);
    if (key === base) return;
    setBase(key);
    setForm(null);
  }, [stored, base]);

  /** Run one action, re-read after it, and say what the server said if it refused. */
  const act = useCallback(
    async (run: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      try {
        await run();
        await refetch();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [refetch],
  );

  // Every connected repository can read a source, so the list is the registry.
  const connected = repos;

  const toggleLink = async (repo: Repo, next: boolean): Promise<void> => {
    setPending((prev) => ({ ...prev, [repo.id]: next }));
    try {
      const current = (await getRepoContextBindings(repo.id)).sourceIds;
      const wanted = next
        ? [...new Set([...current, sourceId])]
        : current.filter((id) => id !== sourceId);
      await putRepoContextBindings(repo.id, wanted);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPending((prev) => {
        const next2 = { ...prev };
        delete next2[repo.id];
        return next2;
      });
    }
  };

  if (!source) {
    return (
      <ContextFrame section="sources" signal={signal} crumbs={[{ label: 'Sources', to: CONTEXT_BASE }, { label: sourceId }]}>
        <p className="px-6 py-4 text-xs text-muted-foreground">
          {error ? `The source could not be read: ${error}` : 'Loading…'}
        </p>
      </ContextFrame>
    );
  }

  const own = ownRepoOf(source);
  // The fields show what is stored until somebody types over it.
  const scope = stored ?? formOf(source);
  const shown = form ?? scope;
  const dirty = JSON.stringify(shown) !== JSON.stringify(scope);
  const edit = (patch: Partial<ScopeForm>): void => setForm({ ...shown, ...patch });

  const save = (): void => {
    setNote(null);
    void act(async () => {
      const answer = await updateContextSourceConfig(source.id, scopeOf(source, shown));
      setNote(answer.note ?? null);
    });
  };

  const right = (
    <>
      <StatusWord tone={CONTEXT_SYNC_TONE[source.status]} word={CONTEXT_SYNC_WORD[source.status]} />
      <button
        type="button"
        className={ACTION}
        disabled={busy || source.status === 'syncing' || source.status === 'paused'}
        onClick={() => void act(() => syncContextSource(source.id))}
      >
        Sync now
      </button>
      <button
        type="button"
        className={ACTION}
        disabled={busy}
        onClick={() => void act(() => pauseContextSource(source.id, source.status !== 'paused'))}
      >
        {source.status === 'paused' ? 'Resume' : 'Pause'}
      </button>
      {source.kind === 'site' && (
        <button
          type="button"
          className={`${ACTION} text-destructive hover:bg-destructive/10`}
          disabled={busy}
          onClick={() => setRemoving(true)}
        >
          Remove
        </button>
      )}
    </>
  );

  return (
    <ContextFrame
      section="sources"
      signal={signal}
      crumbs={[{ label: 'Sources', to: CONTEXT_BASE }, { label: source.title }]}
      right={right}
    >
      <div className="h-full space-y-6 overflow-auto px-6 py-4">
        <section>
          <SectionTitle>Scope</SectionTitle>
          <div className="mt-2 max-w-xl space-y-3">
            {source.kind === 'repository' ? (
              <>
                <div>
                  <span className={LABEL}>Repository</span>
                  <p className="mt-1 font-mono text-xs text-foreground">{own}</p>
                </div>
                <div>
                  <label className={LABEL} htmlFor="scope-branch">
                    Branch
                  </label>
                  <input
                    id="scope-branch"
                    value={shown.branch}
                    placeholder="the default branch"
                    onChange={(e) => edit({ branch: e.target.value })}
                    className={`mt-1 ${FIELD}`}
                  />
                </div>
                <div className="space-y-3">
                  <div>
                    <label className={LABEL} htmlFor="scope-include">
                      Include patterns
                    </label>
                    <textarea
                      id="scope-include"
                      rows={4}
                      value={shown.include}
                      onChange={(e) => edit({ include: e.target.value })}
                      className={`mt-1 font-mono ${FIELD}`}
                    />
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="scope-exclude">
                      Exclude patterns
                    </label>
                    <textarea
                      id="scope-exclude"
                      rows={4}
                      value={shown.exclude}
                      onChange={(e) => edit({ exclude: e.target.value })}
                      className={`mt-1 font-mono ${FIELD}`}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className={LABEL} htmlFor="scope-url">
                  llms.txt URL
                </label>
                <input
                  id="scope-url"
                  value={shown.url}
                  onChange={(e) => edit({ url: e.target.value })}
                  className={`mt-1 ${FIELD}`}
                />
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!dirty || busy}
                onClick={save}
                className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Save
              </button>
              {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
            </div>
          </div>
        </section>

        <section>
          <SectionTitle>Read by</SectionTitle>
          <ul className="mt-2 max-w-xl divide-y divide-border/60 rounded-md border border-border" aria-label="Read by">
            {connected.map((repo) => {
              const isOwn = own === repo.fullName;
              const linked = pending[repo.id] ?? source.repositories.includes(repo.fullName);
              return (
                <li key={repo.id} className="flex items-center gap-3 px-3 py-2">
                  <LinkSwitch
                    label={`${repo.fullName} linked`}
                    checked={isOwn ? true : linked}
                    disabled={busy || isOwn}
                    onToggle={() => void toggleLink(repo, !linked)}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {repo.fullName}
                  </span>
                  {isOwn && <span className="shrink-0 text-[11px] text-muted-foreground">its own repository</span>}
                </li>
              );
            })}
            {connected.length === 0 && (
              <li className="px-3 py-2 text-[11px] text-muted-foreground">
                No repository is connected yet.
              </li>
            )}
          </ul>
        </section>

        <section>
          <SectionTitle>Syncs</SectionTitle>
          <p className="mt-2 text-xs">
            <Link to={documentsHref({ source: source.id })} className="text-foreground hover:underline">
              {source.docCount} document{source.docCount === 1 ? '' : 's'}
            </Link>
          </p>
          {source.status === 'failed' && source.statusNote && (
            <p className="mt-1 text-[11px] leading-snug text-red-600 dark:text-red-400">
              {source.statusNote}
            </p>
          )}
          {syncs.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No sync yet.</p>
          ) : (
            <table className="mt-2 w-full max-w-xl border-collapse text-[13px]" aria-label="Syncs">
              <thead>
                <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="py-1.5 pr-3 text-left font-semibold">When</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Added</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Changed</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Removed</th>
                  <th className="py-1.5 pl-3 text-right font-semibold">Unchanged</th>
                </tr>
              </thead>
              <tbody>
                {syncs.map((sync: ContextSyncRecord) => (
                  <tr key={sync.at} className="border-b border-border/60">
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {formatRelativeTime(sync.at)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{sync.added}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{sync.changed}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{sync.removed}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{sync.unchanged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {source.title}?</DialogTitle>
            <DialogDescription>
              {source.repositories.length > 0
                ? `${source.repositories.join(', ')} ${source.repositories.length === 1 ? 'reads' : 'read'} this source. Removing it re-scans the workspace without its documents.`
                : 'No repository reads this source; removing it changes no corpus.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRemoving(false)}
              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRemoving(false);
                setBusy(true);
                void removeContextSource(source.id)
                  .then(() => navigate(CONTEXT_BASE))
                  .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(false));
              }}
              className="rounded bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ContextFrame>
  );
}
