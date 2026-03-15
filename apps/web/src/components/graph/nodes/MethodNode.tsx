'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap, AlertTriangle } from 'lucide-react';

type MethodNodeData = {
  label: string;
  signature: string;
  paramCount: number;
  returnType?: string;
  isAsync: boolean;
  isExported: boolean;
  lineCount?: number;
  statementCount?: number;
  maxNestingDepth?: number;
};

const DOT_CLASS = '!bg-muted-foreground !border-none !w-[4px] !h-[4px]';

function MethodNodeComponent({ data, selected }: NodeProps & { data: MethodNodeData }) {
  const { label, isAsync, isExported, paramCount, statementCount, maxNestingDepth } = data;

  const hasWarning =
    (statementCount != null && statementCount > 30) ||
    (maxNestingDepth != null && maxNestingDepth > 4) ||
    paramCount >= 5;

  return (
    <div
      className={`min-w-[160px] rounded bg-card/80 transition-all ${
        selected ? 'ring-1 ring-primary/30' : 'border border-border/50'
      }`}
    >
      <Handle type="target" position={Position.Top} id="top" className={DOT_CLASS} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={DOT_CLASS} />

      <div className="flex items-center gap-1.5 px-2 py-1">
        {isAsync && <Zap className="h-2.5 w-2.5 text-yellow-500" />}
        <span className={`text-[11px] truncate ${isExported ? 'font-medium' : ''} text-foreground`}>
          {label}
        </span>
        {hasWarning && <AlertTriangle className="ml-auto h-2.5 w-2.5 text-amber-500" />}
      </div>
    </div>
  );
}

export const MethodNode = memo(MethodNodeComponent);
