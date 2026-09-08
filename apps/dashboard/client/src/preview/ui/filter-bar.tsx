/**
 * THE filter idiom: a labeled row of count chips over a list.
 *
 * One affordance everywhere: a chip carries its option's word and how many rows
 * it keeps, clicking it narrows the list, clicking the active chip again clears.
 * Multi-select surfaces (the corpus area tags) toggle membership instead and get
 * a `clear` link; above {@link OVERFLOW_THRESHOLD} options the chip row stops
 * being readable, so the same filter renders as a typeahead combobox with the
 * selection as removable pills: the identical model, a different shape.
 *
 * Rendered by {@link EntityList}; a surface configures its options and never
 * builds a second filter control.
 */

import { useRef, useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Search, X } from 'lucide-react';

export interface FilterOption {
  key: string;
  /** Display text. */
  label: string;
  /** Rows this option keeps. Omit to render a countless chip. */
  count?: number;
}

/**
 * Above this many options a flat chip row crowds out the list itself, so the
 * filter switches to a type-to-narrow combobox. At or below it, one-click chips
 * are nicer: every option is visible at a glance.
 */
export const OVERFLOW_THRESHOLD = 12;

export interface FilterBarProps {
  /** The lead word: "Status", "Areas". */
  label: string;
  options: FilterOption[];
  /** The selected option keys; empty means "no filter" (everything shows). */
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /** Several options at once (OR semantics), with a clear link. Default single. */
  multi?: boolean;
  /** Group aria-label: what a screen reader calls this control. */
  ariaLabel: string;
  /** Options above which the chips become a combobox. Default {@link OVERFLOW_THRESHOLD}. */
  overflowThreshold?: number;
}

const CHIP = 'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors';

export function FilterBar({
  label,
  options,
  selected,
  onChange,
  multi = false,
  ariaLabel,
  overflowThreshold = OVERFLOW_THRESHOLD,
}: FilterBarProps) {
  if (options.length === 0) return null;
  return options.length > overflowThreshold ? (
    <FilterCombobox
      label={label}
      options={options}
      selected={selected}
      onChange={onChange}
      multi={multi}
      ariaLabel={ariaLabel}
    />
  ) : (
    <FilterChips
      label={label}
      options={options}
      selected={selected}
      onChange={onChange}
      multi={multi}
      ariaLabel={ariaLabel}
    />
  );
}

/** Toggle one key into (or out of) the selection, honouring single vs multi. */
function toggle(selected: readonly string[], key: string, multi: boolean): string[] {
  if (selected.includes(key)) return multi ? selected.filter((k) => k !== key) : [];
  return multi ? [...selected, key] : [key];
}

function FilterChips({ label, options, selected, onChange, multi, ariaLabel }: Required<Pick<FilterBarProps, 'label' | 'options' | 'selected' | 'onChange' | 'multi' | 'ariaLabel'>>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex min-w-0 max-w-full flex-wrap items-center gap-1 border-b border-border px-3 py-2"
    >
      <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {options.map((o) => {
        const on = selected.includes(o.key);
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(toggle(selected, o.key, multi))}
            aria-pressed={on}
            className={`${CHIP} ${
              on
                ? 'bg-primary text-primary-foreground ring-1 ring-inset ring-current'
                : 'bg-muted text-foreground'
            }`}
          >
            {o.label}
            {o.count == null ? '' : ` ${o.count}`}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="ml-1 shrink-0 text-[10px] text-muted-foreground underline hover:text-foreground"
        >
          clear
        </button>
      )}
    </div>
  );
}

/**
 * The many-options shape: the selection as removable pills plus a search input
 * that reveals a scrollable, type-narrowed list of the rest. Portal the popup
 * so it neither expands the toolbar nor gets clipped by a scrolling panel.
 */
function FilterCombobox({ label, options, selected, onChange, multi, ariaLabel }: Required<Pick<FilterBarProps, 'label' | 'options' | 'selected' | 'onChange' | 'multi' | 'ariaLabel'>>) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const selectedList = options.filter((o) => selected.includes(o.key));
  const suggestions = options.filter(
    (o) => !selected.includes(o.key) && (q === '' || o.label.toLowerCase().includes(q)),
  );

  return (
    <Combobox.Root<FilterOption, boolean>
      multiple={multi}
      items={suggestions}
      filter={null}
      value={multi ? selectedList : selectedList[0] ?? null}
      onValueChange={(value, details) => {
        // Escape dismisses the search popup; selected filters have explicit removal controls.
        if (details.reason === 'escape-key') {
          details.cancel();
          return;
        }
        onChange((Array.isArray(value) ? value : value ? [value] : []).map((o) => o.key));
        setQuery('');
      }}
      isItemEqualToValue={(a, b) => a.key === b.key}
      itemToStringLabel={(o) => o.label}
      inputValue={query}
      onInputValueChange={(value, details) => {
        // The selection is shown in pills; keep the input for searching.
        if (details.reason === 'input-change' || details.reason === 'input-clear') setQuery(value);
      }}
      open={open}
      onOpenChange={(next, details) => {
        if (multi && details.reason === 'item-press') details.cancel();
        else setOpen(next);
      }}
    >
      <div ref={containerRef} role="group" aria-label={ariaLabel} className="flex min-w-0 max-w-full flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        {selectedList.map((o) => (
          <span
            key={o.key}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground"
          >
            <span className="min-w-0 truncate" title={o.label}>
              {o.label}
              {o.count == null ? '' : ` ${o.count}`}
            </span>
            <button
              type="button"
              aria-label={`Remove ${o.label}`}
              onClick={() => onChange(toggle(selected, o.key, multi))}
              className="shrink-0 hover:opacity-80"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <div className="flex w-36 max-w-full items-center gap-1">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
          <Combobox.Input
            // Distinct from the GROUP's name: a screen reader announces the
            // control's own job, and a test can address either one.
            aria-label={`Type to filter ${label}`}
            onFocus={() => setOpen(true)}
            placeholder={selectedList.length ? 'Add…' : 'Type to filter…'}
            className="min-w-0 w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="ml-1 shrink-0 text-[10px] text-muted-foreground underline hover:text-foreground"
          >
            clear
          </button>
        )}
      </div>
      <Combobox.Portal>
        <Combobox.Positioner anchor={containerRef} align="start" sideOffset={4} className="z-50">
          <Combobox.Popup className="w-64 max-w-(--available-width) overflow-hidden rounded-md border border-border bg-popover text-popover-foreground">
            <Combobox.List aria-label={`${label} options`} className="max-h-[min(12rem,var(--available-height))] overflow-y-auto py-1">
              {suggestions.map((o) => (
                <Combobox.Item
                  key={o.key}
                  value={o}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1 text-left text-[11px] text-muted-foreground data-highlighted:bg-muted/50 data-highlighted:text-foreground"
                >
                  <span className="truncate">{o.label}</span>
                  {o.count != null && <span className="shrink-0 text-[10px]">{o.count}</span>}
                </Combobox.Item>
              ))}
              {suggestions.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">
                  {q ? `Nothing matches “${query}”.` : 'All options selected.'}
                </div>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
