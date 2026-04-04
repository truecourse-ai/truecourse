import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FolderOpen, AlertTriangle } from 'lucide-react';

type DirectoryNodeData = {
  label: string;
  dirPath: string;
  moduleCount: number;
  violationCount: number;
  layerColor: string;
};

const DOT_CLASS = '!bg-muted-foreground !border-none !w-[5px] !h-[5px] !z-10';

function DirectoryNodeComponent({ data }: NodeProps & { data: DirectoryNodeData }) {
  const { label, moduleCount, violationCount, layerColor } = data;

  return (
    <div
      className="w-full overflow-hidden rounded-md border bg-card/80 shadow-sm"
      style={{ borderLeftWidth: 3, borderLeftColor: layerColor }}
    >
      <Handle type="target" position={Position.Top} id="top" className={DOT_CLASS} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={DOT_CLASS} />
      <Handle type="source" position={Position.Right} id="right-src" className={DOT_CLASS} />
      <Handle type="target" position={Position.Right} id="right-tgt" className={DOT_CLASS} />

      <div className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
        <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground truncate">{label}</span>
        {violationCount > 0 && (
          <div className="group/violation relative shrink-0">
            <AlertTriangle className="h-3 w-3 text-red-500" />
            <div className="pointer-events-none absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 z-[9999] hidden group-hover/violation:block">
              <div className="rounded-md border border-red-500/30 bg-card px-2.5 py-2 shadow-lg w-[180px]">
                <p className="text-[10px] font-semibold text-red-500">{violationCount} violation{violationCount !== 1 ? 's' : ''}</p>
              </div>
            </div>
          </div>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {moduleCount} module{moduleCount !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

export const DirectoryNode = memo(DirectoryNodeComponent);
