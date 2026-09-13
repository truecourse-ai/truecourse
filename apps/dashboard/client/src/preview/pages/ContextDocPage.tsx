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
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import {
  CONTEXT_DOCUMENT_STATUS_WORD,
  type ContextDocumentRow,
} from '@truecourse/shared';
import { createRepoSpecSource } from '@/components/spec/spec-source';
import { DocMarkdown } from '@/components/spec/DocMarkdown';
import { getContextDoc } from '@/lib/api';
import { CONTEXT_DOC_TONE, StatusWord } from '@/preview/ui/status-word';
import { usePreviewState } from '@/preview/shell/preview-state';
import { useContextDocuments, useContextSignal } from '@/preview/shell/use-context';
import { PREVIEW_BASE } from '@/preview/shell/base';
import { ContextFrame } from './ContextFrame';
import { CONTEXT_BASE, documentsHref } from './context-hrefs';
import { CorpusItemPane } from './CorpusItemPane';

/** The repositories this document could be read through, that do not read it yet. */
function Linkable({ row }: { row: ContextDocumentRow }) {
  const { repos } = usePreviewState();
  const could = repos.filter((repo) => !row.repositories.includes(repo.fullName));
  if (could.length === 0) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      Link {row.sourceTitle} on{' '}
      {could.map((repo, i) => (
        <span key={repo.id}>
          {i > 0 && ', '}
          <Link
            to={`${PREVIEW_BASE}/repos/${repo.id}/context`}
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-2">
        <StatusWord tone={CONTEXT_DOC_TONE[row.status]} word={CONTEXT_DOCUMENT_STATUS_WORD[row.status]} />
        <Linkable row={row} />
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
  const { repos } = usePreviewState();

  const row = (documents ?? []).find((doc) => doc.ref === docRef);

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
        readers.length > 1 && reading ? (
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
        ) : undefined
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
