
import { memo } from 'react';
import { Handle, Position, useNodeConnections, type NodeProps } from '@xyflow/react';
import { Monitor, Server, Cog, Package, AlertTriangle, MessageCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { ServiceNodeData } from '@/types/graph';
import { LAYER_COLORS } from '@/types/graph';

type DiffBadge = { newCount: number; resolvedCount: number };

const typeIcons: Record<string, React.ElementType> = {
  frontend: Monitor,
  'api-server': Server,
  worker: Cog,
  library: Package,
  unknown: Package,
};

const DOT_CLASS = '!bg-muted-foreground !border-none !w-[5px] !h-[5px] !z-10';
const HIDDEN_CLASS = '!invisible';

function ServiceNodeComponent({ id, data, selected }: NodeProps & { data: ServiceNodeData & { diffBadge?: DiffBadge } }) {
  const { label, description, serviceInfo, violationCount, hasHighSeverity, onExplain, diffBadge } = data;
  const Icon = typeIcons[serviceInfo.type] || Package;

  const topConnections = useNodeConnections({ handleType: 'target', handleId: 'top' });
  const bottomConnections = useNodeConnections({ handleType: 'source', handleId: 'bottom' });

  const layersPresent = serviceInfo.layers.map((l) => l.layer);

  return (
    <Card
      className={`relative min-w-[220px] !gap-0 !py-0 !overflow-visible rounded-md shadow-md transition-all !bg-card/80 ${
        selected
          ? 'border-primary ring-1 ring-primary/30'
          : ''
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className={topConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS}
      />

      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-foreground">
              {label}
            </h3>
            {serviceInfo.framework && (
              <p className="mt-0.5 text-[10px] italic text-muted-foreground">
                {serviceInfo.framework}
              </p>
            )}
          </div>
          {hasHighSeverity && (
            <div className="flex-shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
          )}
          {diffBadge && (diffBadge.newCount > 0 || diffBadge.resolvedCount > 0) && (
            <div className="flex flex-shrink-0 gap-1">
              {diffBadge.newCount > 0 && (
                <span className="group/diff relative inline-flex items-center rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-500">
                  +{diffBadge.newCount}
                  <span className="pointer-events-none absolute left-1/2 bottom-full mb-1 -translate-x-1/2 z-[9999] hidden group-hover/diff:block whitespace-nowrap rounded bg-popover border border-border px-2 py-1 text-[10px] text-popover-foreground shadow-lg">
                    {diffBadge.newCount} new violation{diffBadge.newCount !== 1 ? 's' : ''} from pending changes
                  </span>
                </span>
              )}
              {diffBadge.resolvedCount > 0 && (
                <span className="group/diff relative inline-flex items-center rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-500">
                  -{diffBadge.resolvedCount}
                  <span className="pointer-events-none absolute left-1/2 bottom-full mb-1 -translate-x-1/2 z-[9999] hidden group-hover/diff:block whitespace-nowrap rounded bg-popover border border-border px-2 py-1 text-[10px] text-popover-foreground shadow-lg">
                    {diffBadge.resolvedCount} violation{diffBadge.resolvedCount !== 1 ? 's' : ''} resolved by pending changes
                  </span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="mx-auto mt-2 w-2/3 border-t border-border" />

        {description && (
          <p className="mt-2 max-w-[240px] text-[10px] leading-tight text-muted-foreground">
            {description}
          </p>
        )}

        {layersPresent.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {LAYER_COLORS.map(({ layer, label, color }) =>
              layersPresent.includes(layer) ? (
                <span
                  key={layer}
                  className="inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[9px] text-muted-foreground"
                  style={{ borderColor: color }}
                >
                  {label}
                </span>
              ) : null,
            )}
          </div>
        )}

        {violationCount > 0 && (
          <div className="mt-2 rounded-md bg-muted px-2 py-1 text-center text-[10px] text-muted-foreground">
            {violationCount} violation{violationCount !== 1 ? 's' : ''}
          </div>
        )}
        <div className="mx-auto mt-2 w-2/3 border-t border-border" />

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] text-muted-foreground">
            {serviceInfo.fileCount} files
          </span>
          {onExplain && (
            <button
              className="flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onExplain(id); }}
            >
              <MessageCircle className="h-2.5 w-2.5" />
              Explain
            </button>
          )}
        </div>
      </CardContent>

      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className={bottomConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS}
      />
    </Card>
  );
}

export const ServiceNode = memo(ServiceNodeComponent);
