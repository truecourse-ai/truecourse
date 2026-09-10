/**
 * The many-dimensions filter: ONE row where the selection sits as removable
 * pills ("Area · Refunds 6") and an Add filter control adds one more in two
 * steps, first the dimension (Area, Status, Source, Repository), then its
 * value, in a DROPDOWN under the control (the list beneath never moves). Same
 * words and pills as {@link FilterBar}'s combobox; where that bar narrows one
 * dimension, this one narrows several without stacking a chip row per
 * dimension. Selected keys are `dimension:value`.
 *
 * Reading: AND across dimensions, OR within one. The surface that owns the list
 * applies that reading; this control only edits the selection.
 */

import { useEffect, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { FilterOption } from './filter-bar';

export interface FilterDimension {
  key: string;
  /** The dimension's word: "Area", "Status". */
  label: string;
  options: FilterOption[];
}

export interface FilterBuilderProps {
  /** The lead word: "Filter". */
  label: string;
  ariaLabel: string;
  dimensions: FilterDimension[];
  /** Selected keys, `dimension:value`; empty means everything shows. */
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

export const filterKey = (dimension: string, value: string) => `${dimension}:${value}`;

export function parseFilterKey(key: string): { dimension: string; value: string } | null {
  const at = key.indexOf(':');
  return at < 0 ? null : { dimension: key.slice(0, at), value: key.slice(at + 1) };
}

/** Values selected along one dimension. */
export function selectedValues(selected: readonly string[], dimension: string): string[] {
  return selected.map(parseFilterKey).filter((k): k is NonNullable<typeof k> => k?.dimension === dimension).map((k) => k.value);
}

const PILL = 'inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground';
const ROW = 'flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground';

/** Past this many values a dimension's list gets a type-to-narrow input. */
const NARROW_FROM = 8;

export function FilterBuilder({ label, ariaLabel, dimensions, selected, onChange }: FilterBuilderProps) {
  const [open, setOpen] = useState(false);
  const [dimension, setDimension] = useState<FilterDimension | null>(null);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setDimension(null);
    setQuery('');
  };

  // Close when focus/clicks leave the widget.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (dimension && dimension.options.length > NARROW_FROM) inputRef.current?.focus();
  }, [dimension]);

  const pills = selected
    .map((key) => {
      const parsed = parseFilterKey(key);
      const dim = parsed && dimensions.find((d) => d.key === parsed.dimension);
      const option = dim?.options.find((o) => o.key === key);
      return dim && option ? { key, dimension: dim, option } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const q = query.trim().toLowerCase();
  const values = dimension ? dimension.options.filter((o) => !selected.includes(o.key) && (q === '' || o.label.toLowerCase().includes(q))) : [];

  return (
    <div ref={containerRef} role="group" aria-label={ariaLabel} className="shrink-0 border-b border-border">
      <div className="flex flex-wrap items-center gap-1 px-3 py-2">
        <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        {pills.map(({ key, dimension: dim, option }) => (
          <span key={key} className={PILL}>
            <span className="opacity-70">{dim.label} ·</span>
            {option.label}
            {option.count == null ? '' : ` ${option.count}`}
            <button
              type="button"
              aria-label={`Remove ${dim.label} ${option.label}`}
              onClick={() => onChange(selected.filter((k) => k !== key))}
              className="hover:opacity-80"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <span className="relative inline-flex">
          <button
            type="button"
            aria-expanded={open}
            aria-haspopup="listbox"
            onClick={() => (open ? close() : setOpen(true))}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          >
            <Plus className="h-2.5 w-2.5" />
            Add filter
          </button>
          {open && (
            <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
              {!dimension ? (
                <div className="py-1" role="listbox" aria-label="Filter by">
                  {dimensions.map((d) => (
                    <button key={d.key} type="button" role="option" aria-selected={false} onClick={() => setDimension(d)} className={ROW}>
                      <span className="truncate">{d.label}</span>
                      <span className="shrink-0 text-[10px]">{d.options.length}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-[11px]">
                    <button type="button" onClick={() => setDimension(null)} className="text-muted-foreground hover:text-foreground hover:underline">
                      Filter by
                    </button>
                    <span className="text-muted-foreground">›</span>
                    <span className="font-medium text-foreground">{dimension.label}</span>
                  </div>
                  {dimension.options.length > NARROW_FROM && (
                    <div className="flex items-center gap-1 border-b border-border/60 px-3 py-1.5">
                      <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <input
                        ref={inputRef}
                        value={query}
                        aria-label={`Type to narrow ${dimension.label}`}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Type to narrow…"
                        className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
                      />
                    </div>
                  )}
                  <div className="max-h-48 overflow-y-auto py-1" role="listbox" aria-label={dimension.label}>
                    {values.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          onChange([...selected, o.key]);
                          close();
                        }}
                        className={ROW}
                      >
                        <span className="truncate">{o.label}</span>
                        {o.count != null && <span className="shrink-0 text-[10px]">{o.count}</span>}
                      </button>
                    ))}
                    {values.length === 0 && (
                      <div className="px-3 py-2 text-[11px] text-muted-foreground/70">
                        {q ? `Nothing matches “${query}”.` : 'Every value is already selected.'}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange([]);
              close();
            }}
            className="ml-auto shrink-0 text-[10px] text-muted-foreground underline hover:text-foreground"
          >
            clear
          </button>
        )}
      </div>
    </div>
  );
}
