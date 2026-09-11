/**
 * THE index of a top-level page: the search full width, ONE filter row (Add
 * filter, the dimension, the value), then a one-line table whose rows open
 * the thing. Code, Tests and Sessions read this way; Context's lists do too.
 * A surface names its columns and renders its cells; the chrome, the row's
 * click and keyboard, the empty line are this component's.
 */

import type { ReactNode } from 'react';
import { FilterBuilder, type FilterDimension } from './filter-builder';

export interface IndexColumn<T> {
  key: string;
  label: string;
  /** Right-aligned, for numbers. */
  align?: 'right';
  /** Extra classes on the cell: a width, a font. */
  className?: string;
  cell: (row: T) => ReactNode;
}

export function IndexTable<T>({
  label,
  rows,
  rowId,
  columns,
  onOpen,
  query,
  onQuery,
  searchPlaceholder,
  dimensions,
  selected,
  onSelect,
  filterLabel = 'Filter',
  filterAriaLabel,
  empty,
}: {
  label: string;
  rows: T[];
  rowId: (row: T) => string;
  columns: IndexColumn<T>[];
  onOpen: (row: T) => void;
  query: string;
  onQuery: (next: string) => void;
  searchPlaceholder: string;
  dimensions: FilterDimension[];
  selected: string[];
  onSelect: (next: string[]) => void;
  filterLabel?: string;
  filterAriaLabel: string;
  /** The one line under an empty table: nothing at all, or nothing that matches. */
  empty: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <FilterBuilder label={filterLabel} ariaLabel={filterAriaLabel} dimensions={dimensions} selected={selected} onChange={onSelect} />
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]" aria-label={label}>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  className={`py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'} ${i === 0 ? 'pl-6 pr-3' : i === columns.length - 1 ? 'pl-3 pr-6' : 'px-3'}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowId(row)}
                tabIndex={0}
                onClick={() => onOpen(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(row);
                }}
                className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={`py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${i === 0 ? 'pl-6 pr-3' : i === columns.length - 1 ? 'pl-3 pr-6' : 'px-3'} ${c.className ?? ''}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-6 py-8 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
