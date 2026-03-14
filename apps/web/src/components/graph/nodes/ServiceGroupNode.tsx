'use client';

import { memo, useState, useCallback } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { Monitor, Server, Cog, Package, AlertTriangle } from 'lucide-react';
import { LAYER_LABELS } from '@/types/graph';
import type { Layer } from '@truecourse/shared';

type Violation = {
  edgeId: string;
  sourceLayer: string;
  targetLayer: string;
  reason: string;
};

type ServiceGroupNodeData = {
  label: string;
  description?: string;
  serviceType: string;
  framework?: string;
  fileCount: number;
  layers: string[];
  violations?: Violation[];
};

const typeIcons: Record<string, React.ElementType> = {
  frontend: Monitor,
  'api-server': Server,
  worker: Cog,
  library: Package,
  unknown: Package,
};

function ServiceGroupNodeComponent({ data, selected }: NodeProps & { data: ServiceGroupNodeData }) {
  const { label, serviceType, framework, violations = [] } = data;
  const Icon = typeIcons[serviceType] || Package;
  const { setEdges } = useReactFlow();
  const [hoveredViolation, setHoveredViolation] = useState<string | null>(null);

  const highlightEdge = useCallback((edgeId: string) => {
    setHoveredViolation(edgeId);
    setEdges((edges) =>
      edges.map((e) =>
        e.id === edgeId ? { ...e, data: { ...e.data, highlighted: true } } : e
      )
    );
  }, [setEdges]);

  const unhighlightEdge = useCallback((edgeId: string) => {
    setHoveredViolation(null);
    setEdges((edges) =>
      edges.map((e) =>
        e.id === edgeId ? { ...e, data: { ...e.data, highlighted: false } } : e
      )
    );
  }, [setEdges]);

  return (
    <div className={`rounded-lg border bg-muted/30 p-0 relative ${selected ? 'border-primary ring-1 ring-primary/30' : 'border-border'}`} style={{ width: '100%', height: '100%' }}>
      <Handle type="target" position={Position.Top} className="!invisible" />
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-xs font-bold text-foreground">{label}</span>
        {framework && (
          <span className="text-[9px] italic text-muted-foreground">{framework}</span>
        )}
      </div>

      {/* Violation badges next to the service card */}
      {violations.length > 0 && (
        <div className="absolute top-10 flex flex-col gap-1.5 z-10" style={{ left: '100%', marginLeft: 6 }}>
          {violations.map((v) => {
            const srcLabel = LAYER_LABELS[v.sourceLayer as Layer] || v.sourceLayer;
            const tgtLabel = LAYER_LABELS[v.targetLayer as Layer] || v.targetLayer;
            return (
              <div
                key={v.edgeId}
                className="group relative"
                onMouseEnter={() => highlightEdge(v.edgeId)}
                onMouseLeave={() => unhighlightEdge(v.edgeId)}
              >
                <div className={`flex items-center gap-1 rounded-md border px-1.5 py-1 cursor-default transition-colors ${
                  hoveredViolation === v.edgeId
                    ? 'bg-red-500 border-red-500 text-white shadow-md'
                    : 'bg-red-500/10 border-red-500/30 text-red-500'
                }`}>
                  <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                  <span className="text-[9px] font-medium whitespace-nowrap">
                    {srcLabel} → {tgtLabel}
                  </span>
                </div>

                {/* Tooltip on hover */}
                <div className="pointer-events-none absolute right-0 top-full mt-1 z-50 hidden group-hover:block">
                  <div className="rounded-md border border-red-500/30 bg-card px-2.5 py-2 shadow-lg max-w-[240px]">
                    <p className="text-[10px] font-semibold text-red-500 mb-1">Architectural Violation</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{v.reason}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!invisible" />
    </div>
  );
}

export const ServiceGroupNode = memo(ServiceGroupNodeComponent);
