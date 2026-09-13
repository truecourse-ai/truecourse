/**
 * THE index of a top-level page: the search full width, ONE filter row (Add
 * filter, the dimension, the value), then a one-line table whose rows open
 * the thing. Code, Tests and Sessions read this way; Context's lists do too.
 * A surface names its columns and renders its cells; the chrome, the row's
 * click and keyboard, the empty line are this component's.
 *
 * The filter row belongs to the surfaces that have dimensions to narrow along;
 * a list that has none (Context's Sources) names none and gets no row.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FilterBuilder, type FilterDimension } from './filter-builder';

/** The narrowest a dragged column may get, in pixels. */
const MIN_COLUMN_PX = 56;

/** A CSS length in rem or px, as pixels. */
function toPx(width: string): number {
  const rem = /^([\d.]+)rem$/.exec(width);
  if (rem) return Number(rem[1]) * 16;
  const px = /^([\d.]+)px$/.exec(width);
  return px ? Number(px[1]) : 0;
}

/**
 * The columns' widths, in pixels, for the sized columns: the declared width
 * to begin with, then whatever the reader dragged, kept per table in the
 * browser so the next visit finds the columns where they were left.
 */
function useColumnWidths(label: string, columns: readonly { key: string; width?: string }[]) {
  const storageKey = `index-table:${label}`;
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const declared: Record<string, number> = {};
    for (const c of columns) if (c.width) declared[c.key] = toPx(c.width);
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Record<string, number> | null;
      if (stored) for (const [key, px] of Object.entries(stored)) if (key in declared) declared[key] = px;
    } catch {
      // No storage, or nothing readable in it: the declared widths stand.
    }
    return declared;
  });
  const set = useCallback(
    (key: string, px: number) => {
      setWidths((prev) => {
        const next = { ...prev, [key]: Math.max(MIN_COLUMN_PX, Math.round(px)) };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Storage refused: the width still holds for this visit.
        }
        return next;
      });
    },
    [storageKey],
  );
  return { widths, set };
}

/**
 * The handle on a sized column's right edge: drag it and the column follows.
 * The first column has none, since it takes what the others leave.
 */
function ResizeHandle({ onResize }: { onResize: (deltaPx: number) => void }) {
  const start = useRef<number | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (start.current === null) return;
      onResize(e.clientX - start.current);
      start.current = e.clientX;
    };
    const up = () => {
      start.current = null;
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [onResize]);
  return (
    <span
      aria-hidden
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start.current = e.clientX;
        document.body.style.cursor = 'col-resize';
      }}
      className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-border"
    />
  );
}

export interface IndexColumn<T> {
  key: string;
  label: string;
  /** Right-aligned, for numbers. */
  align?: 'right';
  /**
   * The column's width (a CSS length). Every column but the first should
   * carry one: the table is fixed-layout, the first column takes what the
   * others leave, and a cell keeps to one line, truncated, unless `wrap`.
   */
  width?: string;
  /** Let the cell wrap (a row of chips) instead of truncating. */
  wrap?: boolean;
  /** Extra classes on the cell: a font, a colour. */
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
  dimensions = [],
  selected = [],
  onSelect = () => {},
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
  /** The dimensions the filter row narrows along; none means no filter row. */
  dimensions?: FilterDimension[];
  selected?: string[];
  onSelect?: (next: string[]) => void;
  filterLabel?: string;
  filterAriaLabel?: string;
  /** The one line under an empty table: nothing at all, or nothing that matches. */
  empty: ReactNode;
}) {
  const { widths, set } = useColumnWidths(label, columns);
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
      {dimensions.length > 0 && (
        <FilterBuilder label={filterLabel} ariaLabel={filterAriaLabel ?? label} dimensions={dimensions} selected={selected} onChange={onSelect} />
      )}
      {/* Fixed layout: the sized columns take their width, the first column
          takes what they leave, and a cell truncates rather than pushing the
          table wider. The page never scrolls sideways. A sized column's right
          edge is a handle: drag it and the column follows, remembered per
          table in this browser. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed border-collapse text-[13px]" aria-label={label}>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  {...(c.width ? { style: { width: `${widths[c.key] ?? toPx(c.width)}px` } } : {})}
                  className={`relative truncate py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'} ${i === 0 ? 'pl-6 pr-3' : i === columns.length - 1 ? 'pl-3 pr-6' : 'px-3'}`}
                >
                  {c.label}
                  {c.width && (
                    <ResizeHandle onResize={(delta) => set(c.key, (widths[c.key] ?? toPx(c.width ?? '0px')) + delta)} />
                  )}
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
                    className={`py-2.5 ${c.wrap ? 'break-words' : 'truncate'} ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${i === 0 ? 'pl-6 pr-3' : i === columns.length - 1 ? 'pl-3 pr-6' : 'px-3'} ${c.className ?? ''}`}
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
