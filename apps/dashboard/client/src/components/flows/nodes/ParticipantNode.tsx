import { memo } from 'react';
import { Globe, Monitor, Database, Zap } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import { DB_TYPE_COLORS, DB_TYPE_LABELS } from '@/lib/database-colors';

type ParticipantData = {
  service: string;
  module: string;
  height: number;
  dbType: string | null;
};

const SPECIAL_PARTICIPANTS: Record<string, { icon: typeof Globe; label: string; color: string }> = {
  'HTTP Client': { icon: Globe, label: 'HTTP', color: '#3b82f6' },
  'Browser': { icon: Monitor, label: 'Browser', color: '#3b82f6' },
  'Event Bus': { icon: Zap, label: 'Events', color: '#a855f7' },
};

function ParticipantNodeComponent({ data }: NodeProps) {
  const { service, module, height, dbType } = data as unknown as ParticipantData;

  const special = SPECIAL_PARTICIPANTS[service];
  // Database if dbType is passed, or if the module field is a known DB type
  const resolvedDbType = dbType || (DB_TYPE_COLORS[module] ? module : null);
  const isDatabase = !!resolvedDbType;
  const dbColor = resolvedDbType ? (DB_TYPE_COLORS[resolvedDbType] || '#6b7280') : '#6b7280';
  const dbLabel = resolvedDbType ? (DB_TYPE_LABELS[resolvedDbType] || service) : 'Database';
  const isCache = resolvedDbType === 'redis';

  return (
    <div className="flex flex-col items-center" style={{ width: 180 }}>
      {/* Header box */}
      {isDatabase ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-border bg-card px-4 py-2 shadow-sm">
          <div
            className="flex items-center justify-center rounded-md p-1"
            style={{ backgroundColor: `${dbColor}20` }}
          >
            {isCache ? (
              <Zap className="h-5 w-5" style={{ color: dbColor }} />
            ) : (
              <Database className="h-5 w-5" style={{ color: dbColor }} />
            )}
          </div>
          <div className="text-[10px] font-semibold text-muted-foreground">{dbLabel}</div>
        </div>
      ) : special ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-border bg-card px-4 py-2 shadow-sm">
          <special.icon className="h-5 w-5" style={{ color: special.color }} />
          <div className="text-[10px] font-semibold text-muted-foreground">{special.label}</div>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-center shadow-sm">
          <div className="text-[10px] font-medium text-muted-foreground">{service}</div>
          <div className="text-xs font-semibold">{module}</div>
        </div>
      )}
      {/* Lifeline */}
      <div
        className="border-l border-dashed border-muted-foreground/30"
        style={{ height: Math.max(height - 60, 40) }}
      />
    </div>
  );
}

export const ParticipantNode = memo(ParticipantNodeComponent);
