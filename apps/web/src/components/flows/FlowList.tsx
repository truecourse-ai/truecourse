import { useState, useMemo } from 'react';
import { Search, Globe, Zap, Clock, Power, ChevronRight, Loader2 } from 'lucide-react';
import type { FlowResponse } from '@/lib/api';
import { SEVERITY_COLORS } from '@/lib/severity-colors';

const triggerIcons: Record<string, typeof Globe> = {
  http: Globe,
  event: Zap,
  cron: Clock,
  startup: Power,
};

const triggerColors: Record<string, string> = {
  http: 'bg-blue-500/20 text-blue-400',
  event: 'bg-amber-500/20 text-amber-400',
  cron: 'bg-purple-500/20 text-purple-400',
  startup: 'bg-emerald-500/20 text-emerald-400',
};

type FlowListProps = {
  flows: FlowResponse[];
  isLoading: boolean;
  onSelectFlow: (flowId: string, flowName: string, pinned: boolean) => void;
  activeFlowId: string | null;
  flowSeverities?: Record<string, string>;
};

export function FlowList({ flows, isLoading, onSelectFlow, activeFlowId, flowSeverities }: FlowListProps) {
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => {
    const filtered = search
      ? flows.filter((f) =>
          f.name.toLowerCase().includes(search.toLowerCase()) ||
          f.entryService.toLowerCase().includes(search.toLowerCase())
        )
      : flows;

    const groups = new Map<string, FlowResponse[]>();
    for (const flow of filtered) {
      const key = flow.entryService;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(flow);
    }
    return groups;
  }, [flows, search]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (flows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-muted-foreground">No flows detected</p>
        <p className="text-xs text-muted-foreground/70">
          Run an analysis to detect execution flows
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search flows..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {/* Flow list */}
      <div className="flex-1 overflow-y-auto">
        {[...grouped.entries()].map(([service, serviceFlows]) => (
          <div key={service}>
            <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {service}
              <span className="rounded-full bg-muted px-1.5 text-[9px]">{serviceFlows.length}</span>
            </div>
            {serviceFlows.map((flow) => {
              const TriggerIcon = triggerIcons[flow.trigger] || Globe;
              const triggerColor = triggerColors[flow.trigger] || 'bg-muted text-muted-foreground';
              const isActive = activeFlowId === flow.id;
              const severity = flowSeverities?.[flow.id];
              const nameColor = severity ? SEVERITY_COLORS[severity] : undefined;

              return (
                <button
                  key={flow.id}
                  onClick={() => onSelectFlow(flow.id, flow.name, false)}
                  onDoubleClick={() => onSelectFlow(flow.id, flow.name, true)}
                  className={`group flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${triggerColor}`}>
                    <TriggerIcon className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" style={nameColor ? { color: nameColor } : undefined}>{flow.name}</div>
                    {flow.description && (
                      <div className="truncate text-[10px] text-muted-foreground">
                        {flow.description}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {flow.stepCount}
                  </span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
