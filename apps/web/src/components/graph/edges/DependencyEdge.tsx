'use client';

import { memo } from 'react';
import {
  getBezierPath,
  EdgeLabelRenderer,
  type EdgeProps,
} from '@xyflow/react';
import type { DependencyEdgeData } from '@/types/graph';

function DependencyEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps & { data?: DependencyEdgeData }) {
  const dependencyCount = data?.dependencyCount ?? 1;
  const hasHttpCalls = data?.hasHttpCalls ?? false;
  const label = data?.label ?? '';

  const strokeWidth = hasHttpCalls ? 1.5 : 1;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const strokeColor = selected ? 'var(--primary)' : 'var(--muted-foreground)';
  const markerId = `dep-arrow-${id}`;

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
          <path d="M 0 1 L 8 5 L 0 9 z" fill={strokeColor} opacity={0.6} />
        </marker>
      </defs>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={hasHttpCalls ? '8 4' : '2 3'}
        opacity={0.6}
        markerEnd={`url(#${markerId})`}
        className="animate-edge-flow"
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="rounded bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm border border-border"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const DependencyEdge = memo(DependencyEdgeComponent);
