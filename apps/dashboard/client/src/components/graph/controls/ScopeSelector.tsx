import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import type { DepthLevel } from '@/types/graph';
import { SCOPE_ALL, type GraphScopeOption, type GraphModuleOption } from '@/hooks/useGraph';

type ScopeSelectorProps = {
  depth: DepthLevel;
  services: GraphScopeOption[];
  modules: GraphModuleOption[];
  scopedServiceId: string | null;
  scopedModuleId: string | null;
  onScopeServiceChange: (id: string | null) => void;
  onScopeModuleChange: (id: string | null) => void;
};

const ALL_SERVICES_OPTION = { id: SCOPE_ALL, label: 'All services' };
const ALL_MODULES_OPTION = { id: SCOPE_ALL, label: 'All modules' };

export function ScopeSelector({
  depth,
  services,
  modules,
  scopedServiceId,
  scopedModuleId,
  onScopeServiceChange,
  onScopeModuleChange,
}: ScopeSelectorProps) {
  if (depth === 'services') return null;

  const serviceOptions = [
    ALL_SERVICES_OPTION,
    ...services.map((s) => ({ id: s.id, label: s.name })),
  ];

  if (depth === 'modules') {
    return (
      <Dropdown
        kind="service"
        options={serviceOptions}
        selectedId={scopedServiceId}
        placeholder="Select service"
        onChange={onScopeServiceChange}
      />
    );
  }

  // methods — cascading picker: service first, then its modules.
  // Showing every module in the repo in one dropdown is unusable at scale
  // (e.g. 100 services × 100 modules); the service step partitions the space.
  const moduleSourceList =
    scopedServiceId && scopedServiceId !== SCOPE_ALL
      ? modules.filter((m) => m.serviceId === scopedServiceId)
      : modules;
  const moduleOptions = [
    ALL_MODULES_OPTION,
    ...moduleSourceList.map((m) => ({ id: m.id, label: m.name })),
  ];

  return (
    <div className="flex items-center gap-2">
      <Dropdown
        kind="service"
        options={serviceOptions}
        selectedId={scopedServiceId}
        placeholder="Select service"
        onChange={(id) => {
          onScopeServiceChange(id);
          // Changing the service invalidates any previously-picked module.
          if (id !== scopedServiceId) onScopeModuleChange(null);
        }}
      />
      <Dropdown
        kind="module"
        options={moduleOptions}
        selectedId={scopedModuleId}
        placeholder={scopedServiceId ? 'Select module' : 'Pick a service first'}
        onChange={onScopeModuleChange}
        disabled={!scopedServiceId}
      />
    </div>
  );
}

type DropdownOption = { id: string; label: string; group?: string; groupId?: string };

function Dropdown({
  kind,
  options,
  selectedId,
  placeholder,
  onChange,
  disabled,
}: {
  kind: 'service' | 'module';
  options: DropdownOption[];
  selectedId: string | null;
  placeholder: string;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const selected = useMemo(() => options.find((o) => o.id === selectedId) ?? null, [options, selectedId]);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.group ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  // Flat list — both service and module dropdowns operate on a single-level option set
  // (methods-depth module dropdown is pre-filtered to the scoped service by the caller).
  const grouped = useMemo(
    () => [{ group: null as string | null, items: filtered }],
    [filtered],
  );

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm transition-colors ${
          disabled
            ? 'cursor-not-allowed opacity-50 text-muted-foreground'
            : selected
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <span className="max-w-40 truncate">
          {selected ? selected.label : placeholder}
        </span>
        {selected && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onChange(null);
              }
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Clear selection"
          >
            <X className="h-3 w-3" />
          </span>
        )}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover shadow-lg">
          <div className="border-b border-border p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${kind === 'service' ? 'services' : 'modules'}...`}
              className="w-full rounded-sm border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">No matches</div>
            ) : (
              grouped.map(({ group, items }) => (
                <div key={group ?? '_'}>
                  {group && (
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group}
                    </div>
                  )}
                  {items.map((o) => {
                    const isSelected = o.id === selectedId;
                    return (
                      <button
                        key={o.id}
                        onClick={() => {
                          onChange(o.id);
                          setOpen(false);
                          setQuery('');
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                          isSelected ? 'bg-accent/50 font-medium text-foreground' : 'text-muted-foreground'
                        }`}
                      >
                        <span className="truncate">{o.label}</span>
                        {isSelected && <Check className="h-3 w-3 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
