/**
 * Context › Claims: every claim the workspace's newest scan read, in the
 * platform's index table, worst first. A claim is one sentence a document
 * states; its status is the worst over the flows that carry it in every
 * repository that holds it, folded on the server (`GET /api/context/claims`),
 * in the five words every coverage surface speaks. A claim no repository holds
 * yet reads Not linked, last with Not testable. The search box narrows by
 * statement or document, the filter row by status, document and repository,
 * and the tally at the foot counts what the list shows by word. A row opens
 * the claim as a side pane (`?claim=`): the sentence, its document, the flows
 * that carry it with their own words, the steps that prove it, and the one
 * ruling a claim takes.
 *
 * The ruling is written to every repository that reads the claim: each keeps
 * its own decisions ledger, and a claim ruled out of testing is ruled out
 * wherever it is tested.
 *
 * The statements the scan judged untestable close the list, quieter: they are
 * what was read and consciously left out, and a reader asking "why is this
 * sentence not tested" finds the answer here rather than in a blank.
 */

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { CONTEXT_DOCUMENT_STATUS_WORD, GUARD_COVERAGE_PLAIN_ORDER, GUARD_COVERAGE_STATUS_WORD } from '@truecourse/shared';
import type { ContextClaimRow, GuardCoveragePlainStatus, GuardUntestableRow } from '@truecourse/shared';
import { GuardClaimDetail, GuardUntestableDetail } from '@/components/guard/GuardClaimDetail';
import { facetDimensions } from '@/dashboard/ui/filter-facets';
import { selectedValues, type FilterDimension } from '@/dashboard/ui/filter-builder';
import { IndexTable, type IndexColumn } from '@/dashboard/ui/index-table';
import { StatusWord, tallyOf, type StatusTone } from '@/dashboard/ui/status-word';
import { useDashboardState } from '@/dashboard/shell/dashboard-state';
import { useContextClaims, useContextSignal } from '@/dashboard/shell/use-context';
import * as api from '@/lib/api';
import { guardPlainStatus } from '@/lib/guard-flow-status';
import { guardUntestableEntries, sortGuardClaims, type GuardUntestableEntry } from '@/lib/guard-claims';
import { ContextFrame } from './ContextFrame';
import { docHref } from './context-hrefs';
import { flowHref } from './flow-hrefs';

/** The five coverage words, and Not linked for a claim no repository holds. */
type ClaimWord = GuardCoveragePlainStatus | 'not-linked';

/** The words in severity order: Not linked last, with Not testable nobody's to-do. */
const WORD_ORDER: readonly ClaimWord[] = [...GUARD_COVERAGE_PLAIN_ORDER, 'not-linked'];

const WORD: Record<ClaimWord, string> = {
  ...GUARD_COVERAGE_STATUS_WORD,
  'not-linked': CONTEXT_DOCUMENT_STATUS_WORD['not-linked'],
};

/** The tone each word wears, in a row and in the tally. */
const WORD_TONE: Record<ClaimWord, StatusTone> = {
  failed: 'failure',
  blocked: 'blocked',
  'never-run': 'unproven',
  'partially-succeeded': 'partial',
  succeeded: 'success',
  'not-testable': 'neutral',
  'not-linked': 'neutral',
};

/** One row: a claim, or a statement the scan judged untestable. */
type ClaimRowData =
  | { kind: 'claim'; id: string; claim: ContextClaimRow; untestable?: never }
  | { kind: 'untestable'; id: string; claim?: never; untestable: GuardUntestableRow };

function wordOf(row: ClaimRowData): ClaimWord {
  if (!row.claim) return 'not-testable';
  return row.claim.status === 'not-linked' ? 'not-linked' : guardPlainStatus(row.claim.status);
}

function textOf(row: ClaimRowData): string {
  return row.claim ? row.claim.statement : row.untestable.statement;
}

function docOf(row: ClaimRowData): string {
  return row.claim ? row.claim.doc : row.untestable.doc;
}

function matchesQuery(row: ClaimRowData, q: string): boolean {
  return q === '' || textOf(row).toLowerCase().includes(q) || docOf(row).toLowerCase().includes(q);
}

export default function ClaimsPage() {
  const signal = useContextSignal();
  const claims = useContextClaims(signal);
  const { repos } = useDashboardState();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('claim');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const untestable = useMemo<GuardUntestableEntry[]>(() => guardUntestableEntries(claims.data), [claims.data]);
  const all = useMemo<ClaimRowData[]>(
    () => [
      ...sortGuardClaims(claims.data?.claims ?? []).map((claim): ClaimRowData => ({ kind: 'claim', id: claim.id, claim })),
      ...untestable.map((entry): ClaimRowData => ({ kind: 'untestable', id: entry.id, untestable: entry.row })),
    ],
    [claims.data, untestable],
  );

  const q = query.trim().toLowerCase();
  const dimensions = useMemo<FilterDimension[]>(() => {
    const docs = [...new Set(all.map(docOf))].sort((a, b) => a.localeCompare(b));
    const repoIds = [...new Set(all.flatMap((row) => row.claim?.repositories ?? []))];
    return facetDimensions<ClaimRowData>({
      rows: all,
      selected,
      matches: (row) => matchesQuery(row, q),
      dimensions: [
        {
          key: 'status',
          label: 'Status',
          valuesOf: (row) => [wordOf(row)],
          values: WORD_ORDER.map((value) => ({ value, label: WORD[value] })),
          hideEmpty: true,
        },
        {
          key: 'doc',
          label: 'Document',
          valuesOf: (row) => [docOf(row)],
          values: docs.map((value) => ({ value, label: value })),
          hideEmpty: true,
        },
        {
          key: 'repo',
          label: 'Repository',
          valuesOf: (row) => row.claim?.repositories ?? [],
          values: repoIds
            .map((value) => ({ value, label: repos.find((r) => r.id === value)?.fullName ?? value }))
            .sort((a, b) => a.label.localeCompare(b.label)),
          hideEmpty: true,
        },
      ],
    });
  }, [all, q, selected, repos]);

  const rows = useMemo(() => {
    const words = selectedValues(selected, 'status');
    const docs = selectedValues(selected, 'doc');
    const readers = selectedValues(selected, 'repo');
    return all.filter(
      (row) =>
        matchesQuery(row, q) &&
        (words.length === 0 || words.includes(wordOf(row))) &&
        (docs.length === 0 || docs.includes(docOf(row))) &&
        (readers.length === 0 || (row.claim?.repositories ?? []).some((id) => readers.includes(id))),
    );
  }, [all, q, selected]);

  const tally = useMemo(
    () => tallyOf(rows, WORD_ORDER, wordOf, (word) => ({ word: WORD[word], tone: WORD_TONE[word] })),
    [rows],
  );

  const selectedRow = selectedId ? all.find((row) => row.id === selectedId) ?? null : null;
  const paneOpen = selectedRow !== null;

  // With a claim open, the pane takes the width the Document and Flows columns
  // had, and says both itself; the list keeps the claim and its status.
  const columns = useMemo<IndexColumn<ClaimRowData>[]>(() => {
    const every: IndexColumn<ClaimRowData>[] = [
      {
        key: 'claim',
        label: 'Claim',
        wrap: true,
        cell: (row) =>
          row.claim ? (
            <span className="block text-[12px] leading-snug text-foreground">{row.claim.statement}</span>
          ) : (
            <span className="block text-[12px] italic leading-snug text-muted-foreground">{row.untestable.statement}</span>
          ),
      },
      {
        key: 'status',
        label: 'Status',
        width: '9rem',
        cell: (row) => <StatusWord tone={WORD_TONE[wordOf(row)]} word={WORD[wordOf(row)]} />,
      },
      {
        key: 'doc',
        label: 'Document',
        width: '14rem',
        className: 'text-muted-foreground',
        cell: (row) => (
          <span className="block truncate" title={docOf(row)}>
            {docOf(row)}
          </span>
        ),
      },
      {
        key: 'flows',
        label: 'Flows',
        width: '16rem',
        className: 'text-muted-foreground',
        cell: (row) => {
          const text = row.claim
            ? row.claim.flows.map((f) => f.title).join(', ') || (row.claim.reason ?? '')
            : row.untestable.reason;
          return (
            <span className="block truncate" title={text}>
              {text}
            </span>
          );
        },
      },
    ];
    return paneOpen ? every.filter((column) => column.key === 'claim' || column.key === 'status') : every;
  }, [paneOpen]);

  const select = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('claim', id);
      else next.delete('claim');
      return next;
    });

  const rule = async (claim: ContextClaimRow, dismiss: boolean) => {
    const identity = { claimId: claim.id };
    await Promise.all(
      claim.repositories.map((id) => (dismiss ? api.dismissGuardClaim(id, identity) : api.undismissGuardClaim(id, identity))),
    );
    // A ruling changes the claim's word, so the list re-reads on it.
    await claims.refetch();
  };

  return (
    <ContextFrame section="claims" signal={signal} crumbs={[{ label: 'Claims' }]}>
      <div className="flex h-full min-h-0">
        <div className="min-w-0 flex-1">
          <IndexTable
            label="Claims"
            rows={rows}
            rowId={(row) => row.id}
            columns={columns}
            onOpen={(row) => select(row.id)}
            query={query}
            onQuery={setQuery}
            searchPlaceholder="Search claims (statement, document)"
            searchLabel="Search claims"
            dimensions={dimensions}
            selected={selected}
            onSelect={setSelected}
            filterAriaLabel="Filter claims"
            tally={tally}
            total={all.length}
            empty={
              !claims.data && !claims.error
                ? 'Loading claims.'
                : claims.error
                  ? claims.error
                  : !claims.data?.extracted
                    ? 'No claims yet. A Document scan reads them from the documents.'
                    : 'No claim matches.'
            }
          />
        </div>
        {selectedRow && (
          <aside className="relative w-[26rem] shrink-0 border-l border-border">
            <button
              type="button"
              onClick={() => select(null)}
              aria-label="Close claim"
              className="absolute right-2 top-2 z-10 rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            {selectedRow.kind === 'claim' ? (
              <GuardClaimDetail
                claim={selectedRow.claim}
                // A ruling is written to the repositories that hold the claim;
                // a claim none holds has nowhere to write one.
                onRule={selectedRow.claim.repositories.length > 0 ? (dismiss) => rule(selectedRow.claim, dismiss) : undefined}
                onOpenDoc={(doc) => navigate(docHref(doc, selectedRow.claim.repositories[0]))}
                onOpenFlow={(flow) => navigate(flowHref(flow.flowId, flow.repo))}
              />
            ) : (
              <GuardUntestableDetail row={selectedRow.untestable} onOpenDoc={(doc) => navigate(docHref(doc))} />
            )}
          </aside>
        )}
      </div>
    </ContextFrame>
  );
}
