'use client';

import { useState } from 'react';
import { Filter, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

type FilterPanelProps = {
  serviceTypes: string[];
  frameworks: string[];
  onFilterChange: (filters: FilterState) => void;
};

export type FilterState = {
  /** Types to exclude from the graph */
  excludedTypes: Set<string>;
  /** Frameworks to exclude from the graph */
  excludedFrameworks: Set<string>;
  searchQuery: string;
  showLabels: boolean;
};

export function FilterPanel({
  serviceTypes,
  frameworks,
  onFilterChange,
}: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    excludedTypes: new Set<string>(),
    excludedFrameworks: new Set<string>(),
    searchQuery: '',
    showLabels: true,
  });

  const updateFilters = (newFilters: FilterState) => {
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const toggleServiceType = (type: string) => {
    const next = new Set(filters.excludedTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    updateFilters({ ...filters, excludedTypes: next });
  };

  const toggleFramework = (fw: string) => {
    const next = new Set(filters.excludedFrameworks);
    if (next.has(fw)) {
      next.delete(fw);
    } else {
      next.add(fw);
    }
    updateFilters({ ...filters, excludedFrameworks: next });
  };

  const hasActiveFilters =
    filters.excludedTypes.size > 0 ||
    filters.excludedFrameworks.size > 0 ||
    filters.searchQuery.length > 0;

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
            {filters.excludedTypes.size + filters.excludedFrameworks.size + (filters.searchQuery ? 1 : 0)}
          </span>
        )}
      </Button>

      {isOpen && (
        <Card className="mt-2 w-64 shadow-lg">
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
                placeholder="Search services..."
                className="pl-8 text-xs"
              />
            </div>

            {/* Service Types */}
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
                      onChange={() => toggleServiceType(type)}
                      className="rounded border-border accent-primary"
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>

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
                        onChange={() => toggleFramework(fw)}
                        className="rounded border-border accent-primary"
                      />
                      {fw}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Show Labels */}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={filters.showLabels}
                onChange={() =>
                  updateFilters({ ...filters, showLabels: !filters.showLabels })
                }
                className="rounded border-border accent-primary"
              />
              Show dependency labels
            </label>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
