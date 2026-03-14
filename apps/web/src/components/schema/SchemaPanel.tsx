'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Database, Table, Key, Link, ChevronDown, ChevronRight, List, GitFork, Fullscreen, X } from 'lucide-react';
import { ERDiagram } from '@/components/schema/ERDiagram';
import * as api from '@/lib/api';

type SchemaPanelProps = {
  repoId: string;
  databaseId: string;
  insights?: import('@/lib/api').InsightResponse[];
};

export function SchemaPanel({ repoId, databaseId, insights = [] }: SchemaPanelProps) {
  const [schema, setSchema] = useState<api.DatabaseSchemaResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'diagram'>('diagram');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Close fullscreen on Escape
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  useEffect(() => {
    setIsLoading(true);
    api.getDatabaseSchema(repoId, databaseId)
      .then(setSchema)
      .catch(() => setSchema(null))
      .finally(() => setIsLoading(false));
  }, [repoId, databaseId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Loading schema...
      </div>
    );
  }

  if (!schema || schema.tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-sm text-muted-foreground gap-2">
        <Database className="h-8 w-8 opacity-50" />
        <span>No schema detected</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Database className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">{schema.name}</span>
        <span className="text-xs text-muted-foreground">
          {schema.tables.length} table{schema.tables.length !== 1 ? 's' : ''}
        </span>

        {/* View toggle + expand */}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            <button
              onClick={() => setView('diagram')}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                view === 'diagram'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="ER Diagram"
            >
              <GitFork className="h-3 w-3" />
            </button>
            <button
              onClick={() => setView('list')}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                view === 'list'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Table List"
            >
              <List className="h-3 w-3" />
            </button>
          </div>
          <button
            onClick={() => { setView('diagram'); setIsFullscreen(true); }}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Expand to fullscreen"
          >
            <Fullscreen className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ER Diagram view */}
      {view === 'diagram' && (
        <div className="flex-1 min-h-0">
          <ERDiagram schema={schema} insights={insights} />
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <div className="flex-1 overflow-y-auto">
          {schema.tables.map((table) => {
            const isExpanded = expandedTable === table.name;
            const tableRelations = schema.relations.filter(
              (r) => r.sourceTable === table.name || r.targetTable === table.name
            );

            return (
              <div key={table.name} className="border-b border-border">
                <button
                  className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-accent/50 transition-colors"
                  onClick={() => setExpandedTable(isExpanded ? null : table.name)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  )}
                  <Table className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-medium text-foreground">{table.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {table.columns.length} col{table.columns.length !== 1 ? 's' : ''}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-3">
                    <div className="rounded-md border border-border overflow-hidden">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="text-left px-2 py-1 font-medium text-muted-foreground">Column</th>
                            <th className="text-left px-2 py-1 font-medium text-muted-foreground">Type</th>
                            <th className="text-center px-2 py-1 font-medium text-muted-foreground w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {table.columns.map((col) => (
                            <tr key={col.name} className="border-t border-border">
                              <td className="px-2 py-1 text-foreground flex items-center gap-1">
                                {col.isPrimaryKey && (
                                  <Key className="h-2.5 w-2.5 text-amber-500 flex-shrink-0" />
                                )}
                                {col.isForeignKey && (
                                  <Link className="h-2.5 w-2.5 text-blue-500 flex-shrink-0" />
                                )}
                                <span>{col.name}</span>
                              </td>
                              <td className="px-2 py-1 text-muted-foreground">{col.type}</td>
                              <td className="px-2 py-1 text-center text-muted-foreground">
                                {col.isNullable && <span className="text-[9px]">?</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {tableRelations.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[10px] font-medium text-muted-foreground mb-1">Relations</div>
                        {tableRelations.map((rel, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground"
                          >
                            <Link className="h-2.5 w-2.5 text-blue-500" />
                            <span>
                              {rel.sourceTable}.{rel.foreignKeyColumn} → {rel.targetTable}
                            </span>
                            <span className="text-[9px] italic">({rel.relationType})</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Fullscreen overlay */}
      {isFullscreen && createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          {/* Fullscreen header */}
          <div className="flex items-center gap-2 border-b border-border px-6 py-3">
            <Database className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">{schema.name}</span>
            <span className="text-xs text-muted-foreground">
              {schema.tables.length} table{schema.tables.length !== 1 ? 's' : ''}
              {schema.relations.length > 0 && ` · ${schema.relations.length} relation${schema.relations.length !== 1 ? 's' : ''}`}
            </span>
            <button
              onClick={() => setIsFullscreen(false)}
              className="ml-auto rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* Fullscreen ER diagram */}
          <div className="flex-1 min-h-0">
            <ERDiagram schema={schema} insights={insights} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
