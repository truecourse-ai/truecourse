
import { memo } from 'react';
import { Handle, Position, useNodeConnections, type NodeProps } from '@xyflow/react';
import { Zap, AlertTriangle, MessageCircle } from 'lucide-react';

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
  isDead?: boolean;
  onExplain?: (nodeId: string) => void;
};

const DOT_CLASS = '!bg-muted-foreground !border-none !w-[4px] !h-[4px] !z-10';
const HIDDEN_CLASS = '!invisible';

function MethodNodeComponent({ id, data, selected }: NodeProps & { data: MethodNodeData }) {
  const { label, isAsync, isExported, paramCount, statementCount, maxNestingDepth, isDead, onExplain } = data;

  const hasWarning =
    (statementCount != null && statementCount > 30) ||
    (maxNestingDepth != null && maxNestingDepth > 4) ||
    paramCount >= 5;

  const topConnections = useNodeConnections({ handleType: 'target', handleId: 'top' });
  const bottomConnections = useNodeConnections({ handleType: 'source', handleId: 'bottom' });
  const rightSrcConnections = useNodeConnections({ handleType: 'source', handleId: 'right-src' });
  const rightTgtConnections = useNodeConnections({ handleType: 'target', handleId: 'right-tgt' });

  const deadTooltip = isDead && (
    <div className="group/dead relative shrink-0">
      <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />
      <div className="pointer-events-none absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 z-[9999] hidden group-hover/dead:block">
        <div className="rounded-md border border-amber-500/30 bg-card px-2.5 py-2 shadow-lg w-[200px]">
          <p className="text-[10px] font-semibold text-amber-500 mb-1">Dead Method</p>
          <p className="text-[10px] text-muted-foreground leading-tight">
            <span className="font-medium text-foreground">{label}</span> has no incoming or outgoing calls — it may be unused.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`rounded transition-all overflow-hidden ${
        isDead ? 'border border-dashed border-amber-500/60 bg-card/60' : 'border border-border/50 bg-card/80'
      } ${selected ? 'bg-card animate-border-pulse' : ''}`}
      style={{ width: '100%', maxWidth: '100%' }}
    >
      <Handle type="target" position={Position.Top} id="top" className={topConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={bottomConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} />
      <Handle type="source" position={Position.Right} id="right-src" className={rightSrcConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} style={{ top: '75%' }} />
      <Handle type="target" position={Position.Right} id="right-tgt" className={rightTgtConnections.length > 0 ? DOT_CLASS : HIDDEN_CLASS} style={{ top: '25%' }} />

      <div className="flex items-center gap-1.5 px-2 py-1 min-w-0">
        {isAsync && <Zap className="h-2.5 w-2.5 shrink-0 text-yellow-500" />}
        <span className={`text-[11px] truncate ${isExported ? 'font-medium' : ''} text-foreground`}>
          {label}
        </span>
        <span className="ml-auto shrink-0" />
        {deadTooltip}
        {hasWarning && !isDead && <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />}
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

export const MethodNode = memo(MethodNodeComponent);
