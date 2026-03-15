'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Monitor, Server, Cog, Package } from 'lucide-react';

type ServiceGroupNodeData = {
  label: string;
  description?: string;
  serviceType: string;
  framework?: string;
  fileCount: number;
  layers: string[];
};

const typeIcons: Record<string, React.ElementType> = {
  frontend: Monitor,
  'api-server': Server,
  worker: Cog,
  library: Package,
  unknown: Package,
};

function ServiceGroupNodeComponent({ data, selected }: NodeProps & { data: ServiceGroupNodeData }) {
  const { label, serviceType, framework } = data;
  const Icon = typeIcons[serviceType] || Package;

  return (
    <div className={`rounded-lg bg-muted/30 p-0 relative ${selected ? 'ring-1 ring-primary/30' : 'border border-border'}`} style={{ width: '100%', height: '100%' }}>
      <Handle type="target" position={Position.Top} className="!invisible" />
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-xs font-bold text-foreground">{label}</span>
        {framework && (
          <span className="text-[9px] italic text-muted-foreground">{framework}</span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!invisible" />
    </div>
  );
}

export const ServiceGroupNode = memo(ServiceGroupNodeComponent);
