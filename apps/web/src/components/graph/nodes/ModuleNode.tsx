'use client';

import { memo } from 'react';
import { Handle, Position, useNodeConnections, type NodeProps } from '@xyflow/react';
import { Box, FileCode, Braces, MessageCircle, AlertTriangle } from 'lucide-react';

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
  const { label, moduleKind, methodCount, layerColor, isDead, onExplain } = data;
  const Icon = KIND_ICONS[moduleKind] || FileCode;

  const topConnections = useNodeConnections({ handleType: 'target', handleId: 'top' });
  const bottomConnections = useNodeConnections({ handleType: 'source', handleId: 'bottom' });
  const rightSrcConnections = useNodeConnections({ handleType: 'source', handleId: 'right-src' });
  const rightTgtConnections = useNodeConnections({ handleType: 'target', handleId: 'right-tgt' });

  return (
    <div
      className={`min-w-[180px] rounded-md shadow-sm transition-all border ${
        isDead ? 'border-dashed border-amber-500/60 bg-card/60' : 'bg-card'
      } ${selected ? 'ring-1 ring-primary/30' : ''}`}
    >
      <Handle type="target" position={Position.Top} id="top" className={topConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={bottomConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} />
      <Handle type="source" position={Position.Right} id="right-src" className={rightSrcConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} style={{ top: '75%' }} />
      <Handle type="target" position={Position.Right} id="right-tgt" className={rightTgtConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} style={{ top: '25%' }} />

      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground truncate">{label}</span>
        {isDead && (
          <div className="group/dead relative shrink-0">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            <div className="pointer-events-none absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 z-50 hidden group-hover/dead:block">
              <div className="rounded-md border border-amber-500/30 bg-card px-2.5 py-2 shadow-lg w-[200px]">
                <p className="text-[10px] font-semibold text-amber-500 mb-1">Dead Module</p>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  <span className="font-medium text-foreground">{label}</span> has no incoming or outgoing dependencies — it may be unused or missing imports.
                </p>
              </div>
            </div>
          </div>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">{methodCount} {methodCount === 1 ? 'method' : 'methods'}</span>
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
