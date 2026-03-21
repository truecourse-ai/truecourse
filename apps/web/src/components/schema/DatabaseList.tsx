
import { useEffect, useState } from 'react';
import { Database, Zap } from 'lucide-react';
import * as api from '@/lib/api';
import { DB_TYPE_COLORS, DB_TYPE_LABELS } from '@/lib/database-colors';

type DatabaseListProps = {
  repoId: string;
  branch?: string;
  activeDbId?: string | null;
  onSelectDatabase: (dbId: string, dbName: string, pinned: boolean) => void;
};

export function DatabaseList({ repoId, branch, activeDbId, onSelectDatabase }: DatabaseListProps) {
  const [databases, setDatabases] = useState<api.DatabaseResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    api.getDatabases(repoId, branch)
      .then(setDatabases)
      .catch(() => setDatabases([]))
      .finally(() => setIsLoading(false));
  }, [repoId, branch]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Loading databases...
      </div>
    );
  }

  if (databases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-sm text-muted-foreground gap-2">
        <Database className="h-8 w-8 opacity-50" />
        <span>No databases detected</span>
        <span className="text-xs">Run an analysis to detect databases</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto h-full">
      {databases.map((db) => {
        const color = DB_TYPE_COLORS[db.type] || '#6b7280';
        const typeLabel = DB_TYPE_LABELS[db.type] || db.type;
        const isCache = db.type === 'redis';
        const Icon = isCache ? Zap : Database;
        const isActive = activeDbId === db.id;

        return (
          <button
            key={db.id}
            onClick={() => onSelectDatabase(db.id, db.name, true)}
            className={`flex items-center gap-3 px-4 py-2.5 text-left border-b border-border transition-colors ${
              isActive
                ? 'bg-accent/50'
                : 'hover:bg-accent/30'
            }`}
          >
            <div
              className="flex items-center justify-center rounded-md p-1.5 shrink-0"
              style={{ backgroundColor: `${color}20` }}
            >
              <Icon className="h-4 w-4" style={{ color }} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium text-foreground truncate">{db.name}</span>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{typeLabel}</span>
                {!isCache && (
                  <span>{db.tableCount} table{db.tableCount !== 1 ? 's' : ''}</span>
                )}
                {db.connectedServices.length > 0 && (
                  <span>{db.connectedServices.length} service{db.connectedServices.length !== 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
