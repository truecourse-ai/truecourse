/**
 * One document of Context: the EXISTING coverage page, the same one everywhere
 * a document opens. The document is painted by section status, a totals strip
 * narrows it to Failed, Blocked, Not run, Proved or Not testable, and a clicked
 * section opens the claims it states and the tests that prove them.
 *
 * Coverage is per repository, so a document several repositories read is read
 * here through ONE of them (`?repo=`), switchable by the chips in the header;
 * the default is the repository with the most to say — the worst reading, which
 * the row already carries.
 *
 * A document NO repository reads has no coverage to show and says so: it opens
 * as the plain document, with the source it came from and the repositories that
 * could read it.
 *
 * This is also where a document is INCLUDED or EXCLUDED, because this is where
 * a reader can see what they are deciding about: the body, and the scan's own
 * words for leaving it out. The one action sits in the header, beside the
 * document's name, and it writes the workspace's decisions — which change
 * nothing until the next Document scan applies them, so the page says so and
 * Context's Scan button lights.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  contextInclusionOf,
  type ContextDocumentDecision,
  type ContextDocumentRow,
} from '@truecourse/shared';
import { createRepoSpecSource, workspaceDecisionWriters } from '@/components/spec/spec-source';
import { DocMarkdown } from '@/components/spec/DocMarkdown';
import { getContextDoc } from '@/lib/api';
import { StatusWord } from '@/dashboard/ui/status-word';
import { useDashboardState } from '@/dashboard/shell/dashboard-state';
import { useContextDocuments, useContextSignal } from '@/dashboard/shell/use-context';
import { ContextFrame } from './ContextFrame';
import { CONTEXT_BASE, documentsHref } from './context-hrefs';
import { contextPendingLine, contextRowWord, contextRowWordKey } from './context-inclusion';
import { CorpusItemPane } from './CorpusItemPane';

const ACTION =
  'rounded border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50';

/** The repositories this document could be read through, that do not read it yet. */
function Linkable({ row }: { row: ContextDocumentRow }) {
  const { repos } = useDashboardState();
  const could = repos.filter((repo) => !row.repositories.includes(repo.fullName));
  if (could.length === 0) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      Link {row.sourceTitle} on{' '}
      {could.map((repo, i) => (
        <span key={repo.id}>
          {i > 0 && ', '}
          <Link
            to={`/repos/${repo.id}/context`}
            className="text-primary hover:underline"
          >
            {repo.fullName}
          </Link>
        </span>
      ))}{' '}
      to have it proven.
    </p>
  );
}

/** The four states a document can be decided from, and the one action each has. */
type InclusionAction = 'include' | 'exclude' | 'undo-include' | 'undo-exclude';

const ACTION_WORD: Record<InclusionAction, string> = {
  include: 'Include',
  exclude: 'Exclude',
  'undo-include': 'Undo include',
  'undo-exclude': 'Undo exclude',
};

/** What the next scan will do with the decision just recorded. */
const ACTION_SAID: Record<InclusionAction, string> = {
  include: 'Included. The next scan adds it to the corpus.',
  exclude: 'Excluded. The next scan drops it from the corpus.',
  'undo-include': 'Include undone. The next scan decides again.',
  'undo-exclude': 'Exclusion undone. The next scan decides again.',
};

/** The decision the action leaves standing. */
const ACTION_LEAVES: Record<InclusionAction, ContextDocumentDecision | null> = {
  include: 'include',
  exclude: 'exclude',
  'undo-include': null,
  'undo-exclude': null,
};

function actionFor(row: ContextDocumentRow): InclusionAction {
  if (row.decision === 'include') return 'undo-include';
  if (row.decision === 'exclude') return 'undo-exclude';
  return row.inCorpus ? 'exclude' : 'include';
}

function writeAction(action: InclusionAction, ref: string): Promise<unknown> {
  switch (action) {
    case 'include':
      return workspaceDecisionWriters.addInclude(ref);
    case 'undo-include':
      return workspaceDecisionWriters.removeInclude(ref);
    case 'exclude':
      return workspaceDecisionWriters.addExclude(ref);
    case 'undo-exclude':
      return workspaceDecisionWriters.removeExclude(ref);
  }
}

/**
 * The one thing a reader can DO to a document, in the header where its name is.
 * The decision is the workspace's and only the next scan applies it, so a
 * decision the corpus has not caught up with stands beside the button in words.
 */
function InclusionAction({
  row,
  onWrote,
}: {
  row: ContextDocumentRow;
  onWrote: (decision: ContextDocumentDecision | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const action = actionFor(row);
  const pending = contextPendingLine(row);

  const press = useCallback(() => {
    if (busy) return;
    setBusy(true);
    writeAction(action, row.ref)
      .then(() => {
        onWrote(ACTION_LEAVES[action]);
        toast.success(ACTION_SAID[action]);
      })
      .catch((e: unknown) =>
        toast.error('The decision could not be recorded', {
          description: e instanceof Error ? e.message : String(e),
        }),
      )
      .finally(() => setBusy(false));
  }, [action, busy, onWrote, row.ref]);

  return (
    <>
      {pending && <span className="text-[11px] text-muted-foreground">{pending}</span>}
      <button type="button" onClick={press} disabled={busy} className={ACTION}>
        {ACTION_WORD[action]}
      </button>
    </>
  );
}

/** A document nothing reads: its body, as the doc viewer renders one. */
function PlainDocument({ row }: { row: ContextDocumentRow }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getContextDoc(row.ref)
      .then((res) => !cancelled && setContent(res.content))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [row.ref]);

  const word = contextRowWord(contextRowWordKey(row));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-2">
        <StatusWord tone={word.tone} word={word.word} />
        {/* A document the corpus does not hold says why in the scan's own words;
            one it holds says who could prove it and does not. */}
        {row.inCorpus ? (
          <Linkable row={row} />
        ) : (
          row.skipReason && <p className="text-[11px] text-muted-foreground">{row.skipReason}</p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {error ? (
          <p className="text-xs text-destructive">The document could not be read: {error}</p>
        ) : content === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <DocMarkdown source={content} />
        )}
      </div>
    </div>
  );
}

export default function ContextDocPage({ docRef }: { docRef: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const signal = useContextSignal();
  const { documents, error } = useContextDocuments(signal);
  const { repos } = useDashboardState();

  const found = (documents ?? []).find((doc) => doc.ref === docRef);

  // The decision this visit recorded, ahead of the read that will confirm it:
  // the row moves now, and the next read settles it.
  const [wrote, setWrote] = useState<ContextDocumentDecision | null | undefined>(undefined);
  useEffect(() => setWrote(undefined), [docRef]);
  const row = useMemo(
    () =>
      found && wrote !== undefined
        ? { ...found, decision: wrote, inclusion: contextInclusionOf(found.inCorpus, wrote) }
        : found,
    [found, wrote],
  );

  // The reading's repository: the one asked for, else the worst — which is the
  // order the row's readings already come in.
  const asked = searchParams.get('repo');
  const readers = useMemo(
    () =>
      (row?.readings ?? []).flatMap((reading) => {
        const repo = repos.find((r) => r.fullName === reading.repository);
        return repo ? [{ id: repo.id, fullName: repo.fullName, status: reading.status }] : [];
      }),
    [row, repos],
  );
  const reading = readers.find((r) => r.id === asked) ?? readers[0];

  const sourceHref = row ? documentsHref({ source: row.sourceId }) : CONTEXT_BASE;

  if (!row) {
    return (
      <ContextFrame section="documents" signal={signal} crumbs={[{ label: 'No such document' }]}>
        <EmptyState
          icon={FileText}
          title={documents === null && !error ? 'Loading…' : 'No such document'}
          body={
            <>
              Nothing of this workspace's context is at that address.{' '}
              <Link to={CONTEXT_BASE} className="text-primary hover:underline">
                Open Context
              </Link>
              .
            </>
          }
        />
      </ContextFrame>
    );
  }

  return (
    <ContextFrame
      section="documents"
      signal={signal}
      crumbs={[{ label: row.sourceTitle, to: sourceHref }, { label: row.title }]}
      right={
        <>
          {readers.length > 1 && reading && (
            // Which repository the document is read through, in the filter
            // idiom's chip shape: one chip per reader, the current one pressed.
            <span role="group" aria-label="Read through repository" className="flex items-center gap-1">
              {readers.map((r) => {
                const on = r.id === reading.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      params.set('repo', r.id);
                      setSearchParams(params, { replace: true });
                    }}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      on
                        ? 'bg-primary text-primary-foreground ring-1 ring-inset ring-current'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    {r.fullName}
                  </button>
                );
              })}
            </span>
          )}
          <InclusionAction row={row} onWrote={setWrote} />
        </>
      }
    >
      {reading ? (
        <RepoReading repoId={reading.id} docRef={docRef} backTo={sourceHref} />
      ) : (
        <PlainDocument row={row} />
      )}
    </ContextFrame>
  );
}

/** The document through one repository: its slice of the corpus, and its coverage. */
function RepoReading({
  repoId,
  docRef,
  backTo,
}: {
  repoId: string;
  docRef: string;
  backTo: string;
}) {
  // Keyed on the repository, so a re-render never rebuilds the source and
  // re-scrolls the open document.
  const source = useMemo(() => createRepoSpecSource(repoId), [repoId]);
  return <CorpusItemPane repoId={repoId} source={source} itemId={docRef} backTo={backTo} />;
}
