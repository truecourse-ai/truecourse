import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

function AnchorNodeComponent({ sourcePosition, targetPosition }: NodeProps) {
  const handleStyle = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 'none' };
  return (
    <div style={{ width: 1, height: 1 }}>
      <Handle type="source" position={sourcePosition || Position.Right} style={handleStyle} />
      <Handle type="target" position={targetPosition || Position.Left} style={handleStyle} />
    </div>
  );
}

export const AnchorNode = memo(AnchorNodeComponent);
