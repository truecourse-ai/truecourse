'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Monitor, Server, Cog, Package, AlertTriangle, MessageCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { ServiceNodeData } from '@/types/graph';
import { LAYER_COLORS } from '@/types/graph';

const typeIcons: Record<string, React.ElementType> = {
  frontend: Monitor,
  'api-server': Server,
  worker: Cog,
  library: Package,
  unknown: Package,
};

function ServiceNodeComponent({ id, data, selected }: NodeProps & { data: ServiceNodeData }) {
  const { label, description, serviceInfo, insightCount, hasHighSeverity, onExplain } = data;
  const Icon = typeIcons[serviceInfo.type] || Package;

  const layersPresent = serviceInfo.layers.map((l) => l.layer);

  return (
    <Card
      className={`relative min-w-[220px] !gap-0 !py-0 rounded-md shadow-md transition-all ${
        selected
          ? 'border-primary ring-1 ring-primary/30'
          : ''
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!invisible"
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

        {insightCount > 0 && (
          <div className="mt-2 rounded-md bg-muted px-2 py-1 text-center text-[10px] text-muted-foreground">
            {insightCount} insight{insightCount !== 1 ? 's' : ''}
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
        className="!invisible"
      />
    </Card>
  );
}

export const ServiceNode = memo(ServiceNodeComponent);
