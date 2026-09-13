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
 * to begin with, then whatever the reader dragged, for this visit. The first
 * column carries no width of its own: it takes what the others leave, so a
 * drag on its edge is a drag on its neighbour.
 *
 * A drag on the line between two columns moves width from one to the other,
 * and the table's total never changes: nothing spills into a third column.
 */
function useColumnWidths(columns: readonly { key: string; width?: string }[]) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const declared: Record<string, number> = {};
    for (const c of columns) if (c.width) declared[c.key] = toPx(c.width);
    return declared;
  });
  const resizeBetween = useCallback(
    (left: number, deltaPx: number) => {
      const a = columns[left];
      const b = columns[left + 1];
      if (!a || !b || !b.width) return;
      setWidths((prev) => {
        const bWidth = prev[b.key] ?? toPx(b.width ?? '0px');
        if (!a.width) {
          // The first column grows by what its neighbour gives up.
          return { ...prev, [b.key]: Math.max(MIN_COLUMN_PX, Math.round(bWidth - deltaPx)) };
        }
        const aWidth = prev[a.key] ?? toPx(a.width);
        const delta = Math.max(MIN_COLUMN_PX - aWidth, Math.min(deltaPx, bWidth - MIN_COLUMN_PX));
        return { ...prev, [a.key]: Math.round(aWidth + delta), [b.key]: Math.round(bWidth - delta) };
      });
    },
    [columns],
  );
  return { widths, resizeBetween };
}

/** The line between two columns, in the header: drag it and the two columns trade width. */
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
      className="absolute inset-y-0 -right-1 w-2 cursor-col-resize hover:bg-primary/40"
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
  const { widths, resizeBetween } = useColumnWidths(columns);
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
          table wider. The page never scrolls sideways. The line between two
          header cells is a handle: drag it and the two columns trade width,
          for this visit. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed border-collapse text-[13px]" aria-label={label}>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  {...(c.width ? { style: { width: `${widths[c.key] ?? toPx(c.width)}px` } } : {})}
                  className={`relative truncate py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'} ${i === 0 ? 'pl-6 pr-3' : i === columns.length - 1 ? 'pl-3 pr-6' : 'px-3'} ${i < columns.length - 1 ? 'border-r border-border' : ''}`}
                >
                  {c.label}
                  {i < columns.length - 1 && <ResizeHandle onResize={(delta) => resizeBetween(i, delta)} />}
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
