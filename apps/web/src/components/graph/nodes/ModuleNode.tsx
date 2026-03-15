'use client';

import { memo, useCallback } from 'react';
import { Handle, Position, useNodeConnections, useReactFlow, type NodeProps } from '@xyflow/react';
import { Box, FileCode, Braces, MessageCircle, AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react';

type ModuleViolation = {
  targetLayer: string;
  reason: string;
  edgeIds?: string[];
};

type ModuleNodeData = {
  label: string;
  moduleKind: string;
  methodCount: number;
  propertyCount?: number;
  importCount?: number;
  exportCount?: number;
  superClass?: string;
  layerColor: string;
  isDead?: boolean;
  isContainer?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: (nodeId: string) => void;
  violations?: ModuleViolation[];
  onExplain?: (nodeId: string) => void;
};

const KIND_ICONS: Record<string, typeof Box> = {
  class: Box,
  interface: Braces,
  standalone: FileCode,
};

const DOT_CLASS = '!bg-muted-foreground !border-none !w-[5px] !h-[5px] !z-10';
const HIDDEN_CLASS = '!invisible';

function ModuleNodeComponent({ id, data, selected }: NodeProps & { data: ModuleNodeData }) {
  const { label, moduleKind, methodCount, layerColor, isDead, isContainer, isCollapsed, onToggleCollapse, violations, onExplain } = data;
  const Icon = KIND_ICONS[moduleKind] || FileCode;
  const { setEdges } = useReactFlow();

  const allViolationEdgeIds = (violations || []).flatMap((v) => v.edgeIds || []);

  const highlightViolations = useCallback(() => {
    if (allViolationEdgeIds.length === 0) return;
    const idSet = new Set(allViolationEdgeIds);
    setEdges((edges) =>
      edges.map((e) => idSet.has(e.id) ? { ...e, data: { ...e.data, highlighted: true } } : e)
    );
  }, [setEdges, allViolationEdgeIds]);

  const unhighlightViolations = useCallback(() => {
    if (allViolationEdgeIds.length === 0) return;
    const idSet = new Set(allViolationEdgeIds);
    setEdges((edges) =>
      edges.map((e) => idSet.has(e.id) ? { ...e, data: { ...e.data, highlighted: false } } : e)
    );
  }, [setEdges, allViolationEdgeIds]);

  const topConnections = useNodeConnections({ handleType: 'target', handleId: 'top' });
  const bottomConnections = useNodeConnections({ handleType: 'source', handleId: 'bottom' });
  const rightSrcConnections = useNodeConnections({ handleType: 'source', handleId: 'right-src' });
  const rightTgtConnections = useNodeConnections({ handleType: 'target', handleId: 'right-tgt' });

  const violationTooltip = violations && violations.length > 0 && (
    <div className="group/violation relative shrink-0" onMouseEnter={highlightViolations} onMouseLeave={unhighlightViolations}>
      <AlertTriangle className="h-3 w-3 text-red-500" />
      <div className="pointer-events-none absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 z-[9999] hidden group-hover/violation:block">
        <div className="rounded-md border border-red-500/30 bg-card px-2.5 py-2 shadow-lg w-[220px]">
          <p className="text-[10px] font-semibold text-red-500 mb-1">Layer Violation</p>
          {violations.map((v, i) => (
            <p key={i} className="text-[10px] text-muted-foreground leading-tight">
              {v.reason}
            </p>
          ))}
        </div>
      </div>
    </div>
  );

  const deadTooltip = isDead && (
    <div className="group/dead relative shrink-0">
      <AlertTriangle className="h-3 w-3 text-amber-500" />
      <div className="pointer-events-none absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 z-[9999] hidden group-hover/dead:block">
        <div className="rounded-md border border-amber-500/30 bg-card px-2.5 py-2 shadow-lg w-[200px]">
          <p className="text-[10px] font-semibold text-amber-500 mb-1">Dead Module</p>
          <p className="text-[10px] text-muted-foreground leading-tight">
            <span className="font-medium text-foreground">{label}</span> has no incoming or outgoing dependencies — it may be unused or missing imports.
          </p>
        </div>
      </div>
    </div>
  );

  // Container mode: transparent wrapper with header (methods render inside)
  if (isContainer) {
    return (
      <div
        className={`rounded-md border bg-muted/10 ${
          violations?.length ? 'border-red-500/60' : isDead ? 'border-dashed border-amber-500/60' : 'border-border/50'
        }`}
        style={{ width: '100%', height: '100%' }}
      >
        <Handle type="target" position={Position.Top} id="top" className={topConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} />
        <Handle type="source" position={Position.Bottom} id="bottom" className={bottomConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} />
        <Handle type="source" position={Position.Right} id="right-src" className={rightSrcConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} />
        <Handle type="target" position={Position.Right} id="right-tgt" className={rightTgtConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} />

        <div className="flex items-center gap-2 px-2.5 py-1">
          {onToggleCollapse && (
            <button
              className="flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors nodrag"
              onClick={(e) => { e.stopPropagation(); onToggleCollapse(id); }}
            >
              {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
          <Icon className="h-2.5 w-2.5 text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground truncate">{label}</span>
          {violationTooltip}
          {deadTooltip}
          <span className="ml-auto shrink-0 text-[9px] text-muted-foreground/60">{methodCount} {methodCount === 1 ? 'method' : 'methods'}</span>
        </div>
      </div>
    );
  }

  // Card mode: compact node (used in modules depth level)
  return (
    <div
      className={`w-full overflow-hidden rounded-md shadow-sm transition-all border ${
        violations?.length ? 'border-red-500/60' : isDead ? 'border-dashed border-amber-500/60 bg-card/60' : 'bg-card/80'
      } ${selected ? 'animate-border-pulse' : ''}`}
    >
      <Handle type="target" position={Position.Top} id="top" className={topConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={bottomConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} />
      <Handle type="source" position={Position.Right} id="right-src" className={rightSrcConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} style={{ top: '75%' }} />
      <Handle type="target" position={Position.Right} id="right-tgt" className={rightTgtConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} style={{ top: '25%' }} />

      <div className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground truncate">{label}</span>
        {violationTooltip}
        {deadTooltip}
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{methodCount} {methodCount === 1 ? 'method' : 'methods'}</span>
        {onExplain && (
          <button
            className="flex items-center justify-center rounded-sm border border-border bg-muted p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onExplain(id); }}
            title="Explain"
          >
            <MessageCircle className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export const ModuleNode = memo(ModuleNodeComponent);
