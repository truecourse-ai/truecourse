
import { memo, useCallback } from 'react';
import { Handle, Position, useNodeConnections, useReactFlow, type NodeProps } from '@xyflow/react';
import { MessageCircle, AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react';
import { LAYER_LABELS } from '@/types/graph';
import type { Layer } from '@truecourse/shared';

type LayerViolation = {
  edgeId?: string;
  edgeIds?: string[];
  targetLayer: string;
  reason: string;
};

type DiffBadge = { newCount: number; resolvedCount: number };

type LayerNodeData = {
  label: string;
  layer: string;
  fileCount: number;
  layerColor: string;
  fileNames: string[];
  isContainer?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: (nodeId: string) => void;
  moduleCount?: number;
  violations?: LayerViolation[];
  onExplain?: (nodeId: string) => void;
  diffBadge?: DiffBadge;
};

const MAX_FILES_SHOWN = 5;

const DOT_CLASS = '!bg-muted-foreground !border-none !w-[5px] !h-[5px] !z-10';
const HIDDEN_CLASS = '!invisible';

function LayerNodeComponent({ id, data }: NodeProps & { data: LayerNodeData }) {
  const { label, fileCount, layerColor, fileNames = [], isContainer, isCollapsed, onToggleCollapse, moduleCount, violations = [], onExplain, diffBadge } = data;
  const layerLabel = LAYER_LABELS[label as Layer] || label;
  const { setEdges } = useReactFlow();

  const allViolationEdgeIds = violations.flatMap((v) => v.edgeIds?.length ? v.edgeIds : v.edgeId ? [v.edgeId] : []);

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

  const violationIcon = violations.length > 0 && (
    <div
      className="group/violation relative shrink-0 pointer-events-auto nodrag"
      onMouseEnter={highlightViolations}
      onMouseLeave={unhighlightViolations}
    >
      <AlertTriangle className="h-3 w-3 text-red-500" />
      <div className="pointer-events-none absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 z-[9999] hidden group-hover/violation:block">
        <div className="rounded-md border border-red-500/30 bg-card px-2.5 py-2 shadow-lg w-[220px]">
          <p className="text-[10px] font-semibold text-red-500 mb-1">Layer Violation</p>
          {violations.map((v, i) => (
            <p key={i} className="text-[10px] text-muted-foreground leading-tight">
              Depends on <span className="font-medium text-foreground">{LAYER_LABELS[v.targetLayer as Layer] || v.targetLayer}</span> — {v.reason}
            </p>
          ))}
        </div>
      </div>
    </div>
  );

  // Container mode: transparent wrapper with just a header (modules/methods render inside)
  if (isContainer) {
    return (
      <div
        className="rounded-md border border-border/50 bg-muted/20"
        style={{ width: '100%', height: '100%' }}
      >
        <Handle type="target" position={Position.Top} id="top" className={HIDDEN_CLASS} />
        <Handle type="source" position={Position.Bottom} id="bottom" className={HIDDEN_CLASS} />
        <Handle type="source" position={Position.Right} id="right-src" className={HIDDEN_CLASS} />
        <Handle type="target" position={Position.Right} id="right-tgt" className={HIDDEN_CLASS} />

        <div className="flex items-center gap-2 px-3 py-1.5">
          {onToggleCollapse && (
            <button
              className="flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors nodrag"
              onClick={(e) => { e.stopPropagation(); onToggleCollapse(id); }}
            >
              {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: layerColor }} />
          <span className="text-[10px] font-medium text-muted-foreground">{layerLabel}</span>
          {isCollapsed && moduleCount !== undefined && (
            <span className="text-[9px] text-muted-foreground/60 ml-auto">{moduleCount} modules</span>
          )}
          {diffBadge && (diffBadge.newCount > 0 || diffBadge.resolvedCount > 0) && (
            <div className="ml-auto flex gap-1">
              {diffBadge.newCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-amber-500/20 px-1 py-0.5 text-[8px] font-semibold text-amber-500">+{diffBadge.newCount}</span>
              )}
              {diffBadge.resolvedCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-1 py-0.5 text-[8px] font-semibold text-emerald-500">-{diffBadge.resolvedCount}</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Card mode: fallback (layers depth level was removed; container mode is the primary usage)
  const shownFiles = fileNames.slice(0, MAX_FILES_SHOWN);
  const remaining = fileNames.length - MAX_FILES_SHOWN;

  return (
    <div
      className="rounded-md border bg-card/80 shadow-sm"
      style={{ borderLeftWidth: 3, borderLeftColor: layerColor, minWidth: 260 }}
    >
      {/* Cross-service edges: top/bottom */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className={topConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className={bottomConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS}
      />

      {/* Intra-service edges: right side */}
      <Handle
        type="source"
        position={Position.Right}
        id="right-src"
        className={rightSrcConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS}
        style={{ top: '75%' }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="right-tgt"
        className={rightTgtConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS}
        style={{ top: '25%' }}
      />

      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: layerColor }}
          />
          <span className="text-xs font-medium text-foreground">{layerLabel}</span>
          {violationIcon}
        </div>
        <div className="flex items-center gap-1.5">
          {diffBadge && (diffBadge.newCount > 0 || diffBadge.resolvedCount > 0) && (
            <>
              {diffBadge.newCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-amber-500/20 px-1 py-0.5 text-[8px] font-semibold text-amber-500">+{diffBadge.newCount}</span>
              )}
              {diffBadge.resolvedCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-1 py-0.5 text-[8px] font-semibold text-emerald-500">-{diffBadge.resolvedCount}</span>
              )}
            </>
          )}
          <span className="text-[10px] text-muted-foreground">{fileCount} files</span>
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

      {shownFiles.length > 0 && (
        <div className="border-t border-border px-3 py-1">
          {shownFiles.map((name) => (
            <div key={name} className="truncate text-[10px] text-muted-foreground leading-[18px]">
              {name}
            </div>
          ))}
          {remaining > 0 && (
            <div className="text-[10px] text-muted-foreground/60 leading-[18px]">
              +{remaining} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const LayerNode = memo(LayerNodeComponent);
