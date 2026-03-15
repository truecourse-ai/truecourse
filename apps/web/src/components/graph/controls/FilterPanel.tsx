'use client';

import { useState } from 'react';
import { Filter, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
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
    <div className="absolute left-4 top-4 z-10">
      <Button
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        className="shadow-md"
      >
        <Filter className="h-4 w-4" />
        Filters
        {hasActiveFilters && (
          <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
            {activeCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <Card className="mt-2 w-64 shadow-lg max-h-[calc(100vh-120px)] overflow-y-auto">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                Filters
              </h3>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Search */}
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={filters.searchQuery}
                onChange={(e) =>
                  updateFilters({ ...filters, searchQuery: e.target.value })
                }
                placeholder={searchPlaceholder}
                className="pl-8 text-xs"
              />
            </div>

            {/* Service Types (includes database) */}
            {(serviceTypes.length > 0 || hasDatabases) && (
              <div className="mb-3">
                <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Service Type
                </h4>
                <div className="space-y-1">
                  {serviceTypes.map((type) => (
                    <label
                      key={type}
                      className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={!filters.excludedTypes.has(type)}
                        onChange={() =>
                          updateFilters({ ...filters, excludedTypes: toggleSet(filters.excludedTypes, type) })
                        }
                        className="rounded border-border accent-primary"
                      />
                      {type}
                    </label>
                  ))}
                  {hasDatabases && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={filters.showDatabases}
                        onChange={() =>
                          updateFilters({ ...filters, showDatabases: !filters.showDatabases })
                        }
                        className="rounded border-border accent-primary"
                      />
                      database
                    </label>
                  )}
                </div>
              </div>
            )}

            {/* Frameworks */}
            {frameworks.length > 0 && (
              <div className="mb-3">
                <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Framework
                </h4>
                <div className="space-y-1">
                  {frameworks.map((fw) => (
                    <label
                      key={fw}
                      className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={!filters.excludedFrameworks.has(fw)}
                        onChange={() =>
                          updateFilters({ ...filters, excludedFrameworks: toggleSet(filters.excludedFrameworks, fw) })
                        }
                        className="rounded border-border accent-primary"
                      />
                      {fw}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Layer Types */}
            {showLayerFilter && (
              <div className="mb-3">
                <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Layer Type
                </h4>
                <div className="space-y-1">
                  {layerTypes.map((layer) => (
                    <label
                      key={layer}
                      className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={!filters.excludedLayers.has(layer)}
                        onChange={() =>
                          updateFilters({ ...filters, excludedLayers: toggleSet(filters.excludedLayers, layer) })
                        }
                        className="rounded border-border accent-primary"
                      />
                      {LAYER_LABELS[layer] || layer}
                    </label>
                  ))}
                </div>
              </div>
            )}

          </CardContent>
        </Card>
      )}
    </div>
  );
}
