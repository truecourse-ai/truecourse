'use client';

import { memo } from 'react';
import {
  getBezierPath,
  EdgeLabelRenderer,
  type EdgeProps,
} from '@xyflow/react';

type DatabaseEdgeData = {
  dependencyCount?: number;
  dependencyType?: string;
};

function DatabaseEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps & { data?: DatabaseEdgeData }) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const isEmphasized = selected;
  const strokeColor = isEmphasized ? 'var(--primary)' : '#f59e0b'; // amber
  const strokeWidth = isEmphasized ? 2 : 1.5;

  const markerId = `db-arrow-${id}`;

  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill={strokeColor} />
        </marker>
      </defs>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray="6 3"
        markerEnd={`url(#${markerId})`}
        className="animate-edge-flow"
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="rounded bg-card px-1.5 py-0.5 text-[10px] font-medium text-amber-500 shadow-sm border border-amber-500/30 z-10"
        >
          <span className="flex items-center gap-1">
            DB
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const DatabaseEdge = memo(DatabaseEdgeComponent);
