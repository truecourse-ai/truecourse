
import { useMemo, useCallback, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Handle,
  EdgeLabelRenderer,
  getBezierPath,
  useNodesState,
  useViewport,
  type Node,
  type Edge,
  type EdgeProps,
  Position,
} from '@xyflow/react';
import dagre from 'dagre';
import { Key, Link, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { ZoomControls } from '@/components/graph/controls/ZoomControls';
import type { DatabaseSchemaResponse, ViolationResponse } from '@/lib/api';

// ── Table node ──────────────────────────────────────────────────────────────

type TableViolation = {
  title: string;
  severity: string;
};

type TableNodeData = {
  label: string;
  columns: DatabaseSchemaResponse['tables'][number]['columns'];
  primaryKey?: string;
  hasSourceEdge?: boolean;
  hasTargetEdge?: boolean;
  violations?: TableViolation[];
};

function TableNode({ data, selected }: { data: TableNodeData; selected?: boolean }) {
  const violationCount = data.violations?.length ?? 0;
  const hasHighSeverity = data.violations?.some((i) => i.severity === 'high' || i.severity === 'critical');

  return (
    <div
      className={`relative rounded-lg border bg-card shadow-md min-w-[180px] max-w-[260px] ${
        selected ? 'border-primary ring-1 ring-primary/30' : violationCount > 0 ? 'border-amber-500/50' : 'border-border'
      }`}
    >
      {data.hasTargetEdge && <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-primary !border-background" />}
      {data.hasSourceEdge && <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-primary !border-background" />}

      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-border bg-amber-500/10 px-3 py-1.5 rounded-t-lg">
        <span className="text-xs font-semibold text-foreground flex-1">{data.label}</span>
        {violationCount > 0 && (
          <div className="group relative flex items-center gap-1">
            <AlertTriangle className={`h-3 w-3 ${hasHighSeverity ? 'text-red-500' : 'text-amber-500'}`} />
            <span className={`text-[9px] font-medium ${hasHighSeverity ? 'text-red-500' : 'text-amber-500'}`}>
              {violationCount}
            </span>
            {/* Tooltip */}
            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 hidden group-hover:block">
              <div className="rounded-md border border-border bg-card px-2.5 py-2 shadow-lg w-[260px]">
                {data.violations!.map((ins, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground leading-tight py-0.5">
                    <span className={`font-medium ${
                      ins.severity === 'critical' || ins.severity === 'high' ? 'text-red-500' :
                      ins.severity === 'medium' ? 'text-amber-500' : 'text-muted-foreground'
                    }`}>
                      [{ins.severity}]
                    </span>{' '}
                    {ins.title}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Columns */}
      <div className="px-1 py-1">
        {data.columns.map((col) => (
          <div
            key={col.name}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded hover:bg-muted/50"
          >
            {col.isPrimaryKey && (
              <Key className="h-2.5 w-2.5 text-amber-500 flex-shrink-0" />
            )}
            {col.isForeignKey && !col.isPrimaryKey && (
              <Link className="h-2.5 w-2.5 text-blue-500 flex-shrink-0" />
            )}
            {!col.isPrimaryKey && !col.isForeignKey && (
              <span className="w-2.5 flex-shrink-0" />
            )}
            <span className="font-medium text-foreground">{col.name}</span>
            <span className="ml-auto text-muted-foreground">{col.type}</span>
            {col.isNullable && <span className="text-muted-foreground/60">?</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Crow's foot edge ────────────────────────────────────────────────────────

type CrowsFootData = {
  sourceCardinality: 'one' | 'many';
  targetCardinality: 'one' | 'many';
  label?: string;
};

function CrowsFootEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps & { data?: CrowsFootData }) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const sourceCard = data?.sourceCardinality ?? 'one';
  const targetCard = data?.targetCardinality ?? 'one';

  // Crow's foot marker at source end
  const sourceMarkerId = `cf-source-${id}`;
  const targetMarkerId = `cf-target-${id}`;

  return (
    <>
      <defs>
        {/* One marker: single vertical line */}
        {sourceCard === 'one' && (
          <marker id={sourceMarkerId} viewBox="0 0 12 12" refX="0" refY="6" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
            <line x1="6" y1="2" x2="6" y2="10" className="stroke-muted-foreground" strokeWidth="1.5" fill="none" />
          </marker>
        )}
        {/* Many marker: crow's foot (three lines fanning out) */}
        {sourceCard === 'many' && (
          <marker id={sourceMarkerId} viewBox="0 0 16 16" refX="0" refY="8" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
            <line x1="10" y1="2" x2="2" y2="8" className="stroke-muted-foreground" strokeWidth="1.5" fill="none" />
            <line x1="2" y1="8" x2="10" y2="14" className="stroke-muted-foreground" strokeWidth="1.5" fill="none" />
            <line x1="2" y1="8" x2="10" y2="8" className="stroke-muted-foreground" strokeWidth="1.5" fill="none" />
          </marker>
        )}
        {targetCard === 'one' && (
          <marker id={targetMarkerId} viewBox="0 0 12 12" refX="12" refY="6" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
            <line x1="6" y1="2" x2="6" y2="10" className="stroke-muted-foreground" strokeWidth="1.5" fill="none" />
          </marker>
        )}
        {targetCard === 'many' && (
          <marker id={targetMarkerId} viewBox="0 0 16 16" refX="16" refY="8" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
            <line x1="6" y1="2" x2="14" y2="8" className="stroke-muted-foreground" strokeWidth="1.5" fill="none" />
            <line x1="14" y1="8" x2="6" y2="14" className="stroke-muted-foreground" strokeWidth="1.5" fill="none" />
            <line x1="14" y1="8" x2="6" y2="8" className="stroke-muted-foreground" strokeWidth="1.5" fill="none" />
          </marker>
        )}
      </defs>
      <path
        id={id}
        d={edgePath}
        fill="none"
        className="stroke-muted-foreground"
        strokeWidth={1.5}
        opacity={0.6}
        markerStart={`url(#${sourceMarkerId})`}
        markerEnd={`url(#${targetMarkerId})`}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
            className="rounded bg-card px-1.5 py-0.5 text-[9px] text-muted-foreground border border-border"
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { tableNode: TableNode };
const edgeTypes = { crowsfoot: CrowsFootEdge };

// ── Cardinality helpers ─────────────────────────────────────────────────────

function parseCardinality(type: string): { source: 'one' | 'many'; target: 'one' | 'many'; label: string } {
  switch (type) {
    case 'one-to-one':
      return { source: 'one', target: 'one', label: '1:1' };
    case 'one-to-many':
      return { source: 'many', target: 'one', label: '1:N' };
    case 'many-to-many':
      return { source: 'many', target: 'many', label: 'N:N' };
    default:
      return { source: 'one', target: 'one', label: '' };
  }
}

// ── Layout ──────────────────────────────────────────────────────────────────

function layoutNodes(
  nodes: Node[],
  edges: Edge[],
  nodeHeights: Map<string, number>,
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 100, nodesep: 50 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const h = nodeHeights.get(node.id) || 100;
    g.setNode(node.id, { width: 200, height: h });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const h = nodeHeights.get(node.id) || 100;
    return {
      ...node,
      position: { x: pos.x - 100, y: pos.y - h / 2 },
    };
  });
}

// ── Main component ──────────────────────────────────────────────────────────

type ERDiagramProps = {
  schema: DatabaseSchemaResponse;
  violations?: ViolationResponse[];
  isFullscreen?: boolean;
};

function DatabaseViolationsBanner({ violations, isFullscreen }: { violations: TableViolation[]; isFullscreen?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { zoom } = useViewport();
  const hasHighSeverity = violations.some((i) => i.severity === 'high' || i.severity === 'critical');

  return (
    <div
      className="absolute left-3 top-3 z-10 origin-top-left"
      style={isFullscreen ? { transform: `scale(${zoom})` } : undefined}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium shadow-sm transition-colors ${
          hasHighSeverity
            ? 'border-red-500/30 bg-red-500/10 text-red-500'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-500'
        }`}
        title={!isFullscreen ? `${violations.length} database issue${violations.length !== 1 ? 's' : ''}` : undefined}
      >
        <AlertTriangle className="h-3 w-3" />
        {isFullscreen && (
          <>
            {violations.length} database issue{violations.length !== 1 ? 's' : ''}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </>
        )}
        {!isFullscreen && (
          <span className="text-[9px]">{violations.length}</span>
        )}
      </button>
      {expanded && isFullscreen && (
        <div className="mt-1 rounded-md border border-border bg-card px-2.5 py-2 shadow-lg w-[280px]">
          {violations.map((ins, i) => (
            <div key={i} className="text-[10px] text-muted-foreground leading-tight py-0.5">
              <span className={`font-medium ${
                ins.severity === 'critical' || ins.severity === 'high' ? 'text-red-500' :
                ins.severity === 'medium' ? 'text-amber-500' : 'text-muted-foreground'
              }`}>
                [{ins.severity}]
              </span>{' '}
              {ins.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ERDiagramInner({ schema, violations = [], isFullscreen }: ERDiagramProps) {
  const { initialNodes, edges } = useMemo(() => {
    const sourceTables = new Set(schema.relations.map((r) => r.sourceTable));
    const targetTables = new Set(schema.relations.map((r) => r.targetTable));

    // Group violations by table name
    const violationsByTable = new Map<string, TableViolation[]>();
    for (const ins of violations) {
      if (ins.targetTable) {
        const existing = violationsByTable.get(ins.targetTable) || [];
        existing.push({ title: ins.title, severity: ins.severity });
        violationsByTable.set(ins.targetTable, existing);
      }
    }

    const rawNodes: Node[] = schema.tables.map((table) => ({
      id: table.name,
      type: 'tableNode',
      data: {
        label: table.name,
        columns: table.columns,
        primaryKey: table.primaryKey,
        hasSourceEdge: sourceTables.has(table.name),
        hasTargetEdge: targetTables.has(table.name),
        violations: violationsByTable.get(table.name),
      } satisfies TableNodeData,
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }));

    const rawEdges: Edge[] = schema.relations.map((rel, i) => {
      const card = parseCardinality(rel.relationType);
      return {
        id: `rel-${i}`,
        source: rel.sourceTable,
        target: rel.targetTable,
        type: 'crowsfoot',
        data: {
          sourceCardinality: card.source,
          targetCardinality: card.target,
          label: rel.foreignKeyColumn,
        } satisfies CrowsFootData,
      };
    });

    const heights = new Map<string, number>();
    for (const table of schema.tables) {
      heights.set(table.name, 28 + table.columns.length * 18 + 8);
    }

    const laidOut = layoutNodes(rawNodes, rawEdges, heights);
    return { initialNodes: laidOut, edges: rawEdges };
  }, [schema, violations]);

  // Database-level violations (no specific table)
  const dbLevelViolations = useMemo(() =>
    violations
      .filter((ins) => ins.targetDatabaseId && !ins.targetTable)
      .map((ins) => ({ title: ins.title, severity: ins.severity })),
    [violations],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  const handleAutoLayout = useCallback(() => {
    const heights = new Map<string, number>();
    for (const table of schema.tables) {
      heights.set(table.name, 28 + table.columns.length * 18 + 8);
    }
    setNodes((curr) => layoutNodes(curr, edges, heights));
  }, [schema, edges, setNodes]);

  return (
    <div className="h-full w-full relative">
      {dbLevelViolations.length > 0 && (
        <DatabaseViolationsBanner violations={dbLevelViolations} isFullscreen={isFullscreen} />
      )}
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={3}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
      </ReactFlow>
      <ZoomControls onAutoLayout={handleAutoLayout} />
    </div>
  );
}

export function ERDiagram({ schema, violations, isFullscreen }: ERDiagramProps) {
  return (
    <ReactFlowProvider>
      <ERDiagramInner schema={schema} violations={violations} isFullscreen={isFullscreen} />
    </ReactFlowProvider>
  );
}
