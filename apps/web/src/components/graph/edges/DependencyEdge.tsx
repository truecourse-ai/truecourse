'use client';

import { memo } from 'react';
import {
  getBezierPath,
  getSmoothStepPath,
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
  const isViolation = data?.isViolation ?? false;
  const label = data?.label ?? '';
  const highlighted = (data as Record<string, unknown>)?.highlighted === true;
  const dimmed = (data as Record<string, unknown>)?.dimmed === true;
  const hidden = (data as Record<string, unknown>)?.hidden === true;
  const useStep = (data as Record<string, unknown>)?.edgeStyle === 'step';

  const isEmphasized = highlighted || selected;
  const strokeWidth = isViolation ? (isEmphasized ? 3 : 2) : isEmphasized ? 2 : hasHttpCalls ? 1.5 : 1;

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

  const strokeColor = isViolation ? '#ef4444' : isEmphasized ? 'var(--primary)' : hasHttpCalls ? '#60a5fa' : 'var(--muted-foreground)';
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
          <path d="M 0 1 L 8 5 L 0 9 z" fill={strokeColor} opacity={hidden ? 0 : dimmed ? 0.08 : 0.6} />
        </marker>
      </defs>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={hasHttpCalls ? '8 4' : '2 3'}
        opacity={hidden ? 0 : dimmed ? 0.08 : isEmphasized ? 1 : 0.6}
        markerEnd={`url(#${markerId})`}
        className={dimmed || hidden ? '' : 'animate-edge-flow'}
        style={{ transition: 'opacity 0.2s ease', pointerEvents: hidden ? 'none' : undefined }}
      />
      {label && !dimmed && !hidden && (
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
