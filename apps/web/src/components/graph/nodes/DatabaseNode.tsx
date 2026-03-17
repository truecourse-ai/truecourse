
import { memo } from 'react';
import { Handle, Position, useNodeConnections, type NodeProps } from '@xyflow/react';
import { Database, Zap } from 'lucide-react';

type DatabaseNodeData = {
  label: string;
  databaseType: string;
  tableCount: number;
  connectedServices: string[];
  framework?: string; // driver name
  onExplain?: (nodeId: string) => void;
};

const DB_TYPE_COLORS: Record<string, string> = {
  postgres: '#336791',
  redis: '#DC382D',
  mongodb: '#47A248',
  mysql: '#4479A1',
  sqlite: '#003B57',
};

const DB_TYPE_LABELS: Record<string, string> = {
  postgres: 'PostgreSQL',
  redis: 'Redis',
  mongodb: 'MongoDB',
  mysql: 'MySQL',
  sqlite: 'SQLite',
};

const HIDDEN_CLASS = '!invisible';

function DatabaseNodeComponent({ id, data, selected }: NodeProps & { data: DatabaseNodeData }) {
  const { label, databaseType, tableCount, connectedServices, framework } = data;
  const color = DB_TYPE_COLORS[databaseType] || '#6b7280';
  const topConnections = useNodeConnections({ handleType: 'target', handleId: 'top' });
  const typeLabel = DB_TYPE_LABELS[databaseType] || databaseType;
  const isCache = databaseType === 'redis';
  const Icon = isCache ? Zap : Database;

  return (
    <div
      className={`min-w-[180px] rounded-lg bg-card/80 shadow-md transition-all ${
        selected ? 'ring-1 ring-primary/30' : 'border'
      }`}
      style={selected ? undefined : { borderColor: color }}
    >
      <Handle type="target" position={Position.Top} id="top" className={topConnections.length > 0 ? '!border-none !w-[5px] !h-[5px] !z-10' : HIDDEN_CLASS} style={topConnections.length > 0 ? { backgroundColor: color } : undefined} />

      <div className="flex items-center gap-2 px-3 py-2">
        <div
          className="flex items-center justify-center rounded-md p-1.5"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-bold text-foreground">{label}</span>
          <span className="text-[10px] text-muted-foreground">{typeLabel}</span>
        </div>
      </div>

      <div className="border-t border-border px-3 py-1.5 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {isCache ? 'Cache store' : `${tableCount} table${tableCount !== 1 ? 's' : ''}`}
        </span>
        {framework && (
          <span className="text-[9px] italic text-muted-foreground">{framework}</span>
        )}
      </div>

      {connectedServices.length > 0 && (
        <div className="border-t border-border px-3 py-1">
          <span className="text-[10px] text-muted-foreground">
            {connectedServices.length} service{connectedServices.length !== 1 ? 's' : ''} connected
          </span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!invisible" />
    </div>
  );
}

export const DatabaseNode = memo(DatabaseNodeComponent);
