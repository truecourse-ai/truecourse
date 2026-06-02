import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export type RunHistoryItem = {
  id: string;
  /** Human label (usually a formatted timestamp). */
  label: string;
  /** Optional branch shown muted next to the label. */
  branch?: string | null;
};

/**
 * Past-runs dropdown, shared by analyze (analyses) and verify (verify runs).
 * `items` are newest-first with `items[0]` being the latest; selecting it (or
 * the explicit "Latest" entry) calls `onSelect(null)`. `selectedId` is null
 * when viewing the latest.
 */
export function RunHistoryDropdown({
  items,
  selectedId,
  onSelect,
}: {
  items: RunHistoryItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (items.length <= 1) return null;

  const selectedLabel = selectedId ? items.find((i) => i.id === selectedId)?.label ?? 'Past run' : 'Latest';

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {selectedLabel}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-56 rounded-md border border-border bg-popover shadow-lg">
          <div className="max-h-64 overflow-y-auto py-1">
            <button
              className={`w-full whitespace-nowrap px-3 py-1.5 text-left text-xs hover:bg-accent transition-colors ${
                !selectedId ? 'bg-accent/50 font-medium text-foreground' : 'text-muted-foreground'
              }`}
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
            >
              Latest
            </button>
            {items.map((item, i) => {
              const isLatest = i === 0;
              const active = isLatest ? !selectedId : selectedId === item.id;
              return (
                <button
                  key={item.id}
                  className={`w-full whitespace-nowrap px-3 py-1.5 text-left text-xs hover:bg-accent transition-colors ${
                    active ? 'bg-accent/50 font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                  onClick={() => {
                    onSelect(isLatest ? null : item.id);
                    setOpen(false);
                  }}
                >
                  <span>{item.label}</span>
                  {item.branch && <span className="ml-1.5 font-mono opacity-60">{item.branch}</span>}
                  {isLatest && <span className="ml-1.5 text-primary/70">(latest)</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
