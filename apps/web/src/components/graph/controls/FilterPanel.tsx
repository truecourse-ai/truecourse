'use client';

import { useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { DepthLevel } from '@/types/graph';

type FilterPanelProps = {
  depthLevel: DepthLevel;
  serviceTypes: string[];
  frameworks: string[];
  layerTypes: string[];
  hasDatabases: boolean;
  onFilterChange: (filters: FilterState) => void;
};

export type FilterState = {
  excludedTypes: Set<string>;
  excludedFrameworks: Set<string>;
  excludedLayers: Set<string>;
  searchQuery: string;
  showDatabases: boolean;
};

const LAYER_LABELS: Record<string, string> = {
  api: 'Routes & Controllers',
  service: 'Business Logic',
  data: 'Database & ORM',
  external: 'HTTP Clients',
};

export function FilterPanel({
  depthLevel,
  serviceTypes,
  frameworks,
  layerTypes,
  hasDatabases,
  onFilterChange,
}: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    excludedTypes: new Set<string>(),
    excludedFrameworks: new Set<string>(),
    excludedLayers: new Set<string>(),
    searchQuery: '',
    showDatabases: true,
  });

  const updateFilters = (newFilters: FilterState) => {
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const toggleSet = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const hasActiveFilters =
    filters.excludedTypes.size > 0 ||
    filters.excludedFrameworks.size > 0 ||
    filters.excludedLayers.size > 0 ||
    filters.searchQuery.length > 0 ||
    !filters.showDatabases;

  const activeCount =
    filters.excludedTypes.size +
    filters.excludedFrameworks.size +
    filters.excludedLayers.size +
    (filters.searchQuery ? 1 : 0) +
    (!filters.showDatabases ? 1 : 0);

  const showLayerFilter = depthLevel !== 'services' && layerTypes.length > 0;

  const searchPlaceholder =
    depthLevel === 'services' ? 'Search services...' :
    depthLevel === 'methods' ? 'Search methods...' :
    depthLevel === 'modules' ? 'Search modules...' :
    'Search...';

  return (
    <div className="absolute left-4 top-3 z-10">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Filter className="h-3.5 w-3.5" />
        Filters
        {hasActiveFilters && (
          <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
            {activeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="mt-1.5 w-56 rounded-md border border-border bg-card p-2.5 shadow-lg max-h-[calc(100vh-120px)] overflow-y-auto">
          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={filters.searchQuery}
              onChange={(e) =>
                updateFilters({ ...filters, searchQuery: e.target.value })
              }
              placeholder={searchPlaceholder}
              className="h-7 pl-7 text-[11px]"
            />
          </div>

          {/* Service Types (includes database) */}
          {(serviceTypes.length > 0 || hasDatabases) && (
            <div className="mb-2">
              <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Type
              </h4>
              <div className="space-y-0.5">
                {serviceTypes.map((type) => (
                  <label
                    key={type}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-foreground hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={!filters.excludedTypes.has(type)}
                      onChange={() =>
                        updateFilters({ ...filters, excludedTypes: toggleSet(filters.excludedTypes, type) })
                      }
                      className="rounded border-border accent-primary h-3 w-3"
                    />
                    {type}
                  </label>
                ))}
                {hasDatabases && (
                  <label className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-foreground hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={filters.showDatabases}
                      onChange={() =>
                        updateFilters({ ...filters, showDatabases: !filters.showDatabases })
                      }
                      className="rounded border-border accent-primary h-3 w-3"
                    />
                    database
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Frameworks */}
          {frameworks.length > 0 && (
            <div className="mb-2">
              <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Framework
              </h4>
              <div className="space-y-0.5">
                {frameworks.map((fw) => (
                  <label
                    key={fw}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-foreground hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={!filters.excludedFrameworks.has(fw)}
                      onChange={() =>
                        updateFilters({ ...filters, excludedFrameworks: toggleSet(filters.excludedFrameworks, fw) })
                      }
                      className="rounded border-border accent-primary h-3 w-3"
                    />
                    {fw}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Layer Types */}
          {showLayerFilter && (
            <div>
              <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Layer
              </h4>
              <div className="space-y-0.5">
                {layerTypes.map((layer) => (
                  <label
                    key={layer}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-foreground hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={!filters.excludedLayers.has(layer)}
                      onChange={() =>
                        updateFilters({ ...filters, excludedLayers: toggleSet(filters.excludedLayers, layer) })
                      }
                      className="rounded border-border accent-primary h-3 w-3"
                    />
                    {LAYER_LABELS[layer] || layer}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
