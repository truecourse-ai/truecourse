'use client';

import { memo } from 'react';
import {
  getBezierPath,
  getSmoothStepPath,
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
  const dimmed = (data as Record<string, unknown>)?.dimmed === true;
  const hidden = (data as Record<string, unknown>)?.hidden === true;
  const useStep = (data as Record<string, unknown>)?.edgeStyle === 'step';

  const pathFn = useStep ? getSmoothStepPath : getBezierPath;
  const [edgePath, labelX, labelY] = pathFn({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    ...(useStep ? { borderRadius: 8 } : {}),
  });
  const isEmphasized = selected;
  const strokeColor = isEmphasized ? 'var(--primary)' : '#f59e0b'; // amber
  const strokeWidth = isEmphasized ? 2 : 1.5;
  const opacity = hidden ? 0 : dimmed ? 0.08 : 1;

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
          <path d="M 0 1 L 8 5 L 0 9 z" fill={strokeColor} opacity={opacity} />
        </marker>
      </defs>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray="6 3"
        opacity={opacity}
        markerEnd={`url(#${markerId})`}
        className={dimmed || hidden ? '' : 'animate-edge-flow'}
        style={{ transition: 'opacity 0.2s ease', pointerEvents: hidden ? 'none' : undefined }}
      />
      {!dimmed && !hidden && <EdgeLabelRenderer>
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
      </EdgeLabelRenderer>}
    </>
  );
}

export const DatabaseEdge = memo(DatabaseEdgeComponent);
