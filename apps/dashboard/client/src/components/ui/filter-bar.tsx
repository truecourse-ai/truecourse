/**
 * Compact pill filter bar — a labeled row of count pills with single-select
 * toggle-off semantics (click a pill to filter to it; re-click clears). Shared by
 * the Verify drift list (severity) and the Inferred list (confidence) so the filter
 * affordance is identical across tabs. Renders nothing when there are no options.
 */

export interface FilterOption {
  key: string;
  /** Display text (rendered `capitalize`). */
  label: string;
  count: number;
  /** Tailwind tone classes (bg + text) for the active pill. */
  tone?: string;
}

export function FilterBar({
  label,
  options,
  active,
  onSelect,
}: {
  label: string;
  options: FilterOption[];
  active: string | null;
  onSelect: (key: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      {options.map((o) => {
        const isActive = active === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onSelect(o.key)}
            aria-pressed={isActive}
            className={`rounded px-1.5 py-0.5 font-medium capitalize transition-colors ${
              isActive
                ? `${o.tone ?? 'bg-muted text-foreground'} ring-1 ring-inset ring-current`
                : 'text-muted-foreground hover:bg-muted/60'
            }`}
          >
            {o.label} {o.count}
          </button>
        );
      })}
    </div>
  );
}
