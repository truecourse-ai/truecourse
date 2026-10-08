/**
 * Claims: every claim the documents this repository reads make, in the
 * platform's index table, worst first. A claim is one sentence a document
 * states; its status is the worst over the flows that carry it, in the five
 * words every coverage surface speaks. The search box narrows by statement or
 * document, the filter row by status and document, and the tally at the foot
 * counts what the list shows by word. A row opens the claim as a side pane
 * (`?claim=`): the sentence, its document, the flows that carry it with their
 * own words, the steps that prove it, and the one ruling a claim takes.
 *
 * The statements the scan judged untestable close the list, quieter: they are
 * what was read and consciously left out, and a reader asking "why is this
 * sentence not tested" finds the answer here rather than in a blank.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { GUARD_COVERAGE_PLAIN_ORDER, GUARD_COVERAGE_STATUS_WORD } from '@truecourse/shared';
import type { GuardClaimRow, GuardCoveragePlainStatus, GuardUntestableRow } from '@truecourse/shared';
import { GuardClaimDetail, GuardUntestableDetail } from '@/components/guard/GuardClaimDetail';
import { GuardFlowStatusChip } from '@/components/guard/GuardStatusBadge';
import type { Repo } from '@/dashboard/data/types';
import { facetDimensions } from '@/dashboard/ui/filter-facets';
import { selectedValues, type FilterDimension } from '@/dashboard/ui/filter-builder';
import { IndexTable, type IndexColumn } from '@/dashboard/ui/index-table';
import { tallyOf, type StatusTone } from '@/dashboard/ui/status-word';
import { useGuardClaims } from '@/hooks/useGuardClaims';
import { useGuardDecisions } from '@/hooks/useGuardDecisions';
import { useGuardView } from '@/hooks/useGuardView';
import { guardPlainStatus } from '@/lib/guard-flow-status';
import { guardUntestableEntries, sortGuardClaims, type GuardUntestableEntry } from '@/lib/guard-claims';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';

/** The tone each of the five words wears in a tally. */
const WORD_TONE: Record<GuardCoveragePlainStatus, StatusTone> = {
  failed: 'failure',
  blocked: 'blocked',
  'never-run': 'unproven',
  'partially-succeeded': 'partial',
  succeeded: 'success',
  'not-testable': 'neutral',
};

/** One row: a claim, or a statement the scan judged untestable. */
type ClaimRowData =
  | { kind: 'claim'; id: string; claim: GuardClaimRow; untestable?: never }
  | { kind: 'untestable'; id: string; claim?: never; untestable: GuardUntestableRow };

function wordOf(row: ClaimRowData): GuardCoveragePlainStatus {
  return row.claim ? guardPlainStatus(row.claim.status) : 'not-testable';
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

export function ClaimsTab({ repo }: { repo: Repo }) {
  useGuardTabJump(repo.id);
  const reloadKey = useGuardRefresh(repo, ['guard-generate', 'guard-run']);
  const decisions = useGuardDecisions(repo.id, true, reloadKey);
  // A ruling changes a claim's word, so the list re-reads on it.
  const claims = useGuardClaims(repo.id, true, reloadKey + decisions.flowRevision);
  const { openSpecDoc, openGuardFlow } = useGuardView();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('claim');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const untestable = useMemo<GuardUntestableEntry[]>(() => guardUntestableEntries(claims.view), [claims.view]);
  const all = useMemo<ClaimRowData[]>(
    () => [
      ...sortGuardClaims(claims.view?.claims ?? []).map((claim): ClaimRowData => ({ kind: 'claim', id: claim.id, claim })),
      ...untestable.map((entry): ClaimRowData => ({ kind: 'untestable', id: entry.id, untestable: entry.row })),
    ],
    [claims.view, untestable],
  );

  const q = query.trim().toLowerCase();
  const dimensions = useMemo<FilterDimension[]>(() => {
    const docs = [...new Set(all.map(docOf))].sort((a, b) => a.localeCompare(b));
    return facetDimensions<ClaimRowData>({
      rows: all,
      selected,
      matches: (row) => matchesQuery(row, q),
      dimensions: [
        {
          key: 'status',
          label: 'Status',
          valuesOf: (row) => [wordOf(row)],
          values: GUARD_COVERAGE_PLAIN_ORDER.map((value) => ({ value, label: GUARD_COVERAGE_STATUS_WORD[value] })),
          hideEmpty: true,
        },
        {
          key: 'doc',
          label: 'Document',
          valuesOf: (row) => [docOf(row)],
          values: docs.map((value) => ({ value, label: value })),
          hideEmpty: true,
        },
      ],
    });
  }, [all, q, selected]);

  const rows = useMemo(() => {
    const words = selectedValues(selected, 'status');
    const docs = selectedValues(selected, 'doc');
    return all.filter(
      (row) =>
        matchesQuery(row, q) &&
        (words.length === 0 || words.includes(wordOf(row))) &&
        (docs.length === 0 || docs.includes(docOf(row))),
    );
  }, [all, q, selected]);

  const tally = useMemo(
    () => tallyOf(rows, GUARD_COVERAGE_PLAIN_ORDER, wordOf, (word) => ({ word: GUARD_COVERAGE_STATUS_WORD[word], tone: WORD_TONE[word] })),
    [rows],
  );

  const columns = useMemo<IndexColumn<ClaimRowData>[]>(
    () => [
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
        cell: (row) => <GuardFlowStatusChip status={wordOf(row)} />,
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
    ],
    [],
  );

  const select = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('claim', id);
      else next.delete('claim');
      return next;
    });
  const selectedRow = selectedId ? all.find((row) => row.id === selectedId) ?? null : null;

  return (
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
            claims.loading
              ? 'Loading claims.'
              : claims.error
                ? claims.error
                : !claims.view?.extracted
                  ? 'No claims yet. A Document scan reads them from the documents this repository reads.'
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
          {selectedRow.claim ? (
            <GuardClaimDetail
              repoId={repo.id}
              claim={selectedRow.claim}
              decisions={decisions}
              onOpenDoc={openSpecDoc}
              onOpenFlow={openGuardFlow}
            />
          ) : (
            <GuardUntestableDetail row={selectedRow.untestable} onOpenDoc={openSpecDoc} />
          )}
        </aside>
      )}
    </div>
  );
}
