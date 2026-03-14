'use client';

import { memo } from 'react';
import { Handle, Position, useHandleConnections, type NodeProps } from '@xyflow/react';
import { MessageCircle } from 'lucide-react';
import { LAYER_LABELS } from '@/types/graph';
import type { Layer } from '@truecourse/shared';

type LayerNodeData = {
  label: string;
  layer: string;
  fileCount: number;
  layerColor: string;
  fileNames: string[];
  onExplain?: (nodeId: string) => void;
};

const MAX_FILES_SHOWN = 5;

const DOT_CLASS = '!bg-muted-foreground !border-none !w-[5px] !h-[5px]';
const HIDDEN_CLASS = '!invisible';

function LayerNodeComponent({ id, data }: NodeProps & { data: LayerNodeData }) {
  const { label, fileCount, layerColor, fileNames = [], onExplain } = data;
  const layerLabel = LAYER_LABELS[label as Layer] || label;
  const shownFiles = fileNames.slice(0, MAX_FILES_SHOWN);
  const remaining = fileNames.length - MAX_FILES_SHOWN;

  const topConnections = useHandleConnections({ type: 'target', id: 'top' });
  const bottomConnections = useHandleConnections({ type: 'source', id: 'bottom' });
  const rightSrcConnections = useHandleConnections({ type: 'source', id: 'right-src' });
  const rightTgtConnections = useHandleConnections({ type: 'target', id: 'right-tgt' });

  return (
    <div
      className="rounded-md border bg-card shadow-sm"
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
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">{fileCount} files</span>
          {onExplain && (
            <button
              className="flex cursor-pointer items-center justify-center rounded-sm border border-border bg-muted p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
