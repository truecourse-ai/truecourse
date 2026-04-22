import { memo } from 'react';
import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';

const stepTypeColors: Record<string, string> = {
  call: '#6b7280',
  http: '#3b82f6',
  'db-read': '#22c55e',
  'db-write': '#f59e0b',
  event: '#a855f7',
};

function StepEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
}: EdgeProps) {
  const edgeData = data as {
    stepType: string;
    dbColor: string | null;
    isAsync: boolean;
    isActive: boolean;
    isCurrent: boolean;
    isAnimating: boolean;
    isPlayed: boolean;
    showTrail: boolean;
    showEndDot: boolean;
    isSelf?: boolean;
  };

  // Self-calls draw a UML-style loop: right out of the lifeline, down,
  // and back in with the arrowhead. Regular steps use a straight path.
  const edgePath = edgeData.isSelf
    ? buildSelfLoopPath(sourceX, sourceY, targetX, targetY)
    : getStraightPath({ sourceX, sourceY, targetX, targetY })[0];

  const activeColor = edgeData.dbColor || stepTypeColors[edgeData.stepType] || '#6b7280';
  const color = edgeData.isActive ? activeColor : '#374151';
  const markerId = `arrow-${id}`;
  // Animate the dash pattern for played/current steps (marching ants — persists after completion)
  const shouldAnimateDash = (edgeData.isPlayed || edgeData.isCurrent) && edgeData.showTrail;

  return (
    <>
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L8,3 L0,6 Z" fill={color} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: color,
          strokeWidth: 1,
          strokeDasharray: '4,3',
          animation: shouldAnimateDash ? 'flowDash 0.5s linear infinite' : undefined,
        }}
        markerEnd={`url(#${markerId})`}
      />
      {/* Dot traveling on the current step */}
      {edgeData.isAnimating && (
        <circle r="3" fill={color}>
          <animateMotion dur="0.8s" repeatCount="1" fill="freeze" path={edgePath} />
        </circle>
      )}
      {/* Static dot at end of last step after playback completes */}
      {edgeData.showEndDot && (
        <circle cx={targetX} cy={targetY} r="3" fill={color} />
      )}
    </>
  );
}

export const StepEdge = memo(StepEdgeComponent);

/** UML self-call loop: right (out of the lifeline), down, left (back into
 *  the lifeline). Source and target anchors share the same X; the layout
 *  puts the target a few pixels below the source so this path has
 *  vertical extent to render. */
function buildSelfLoopPath(sx: number, sy: number, tx: number, ty: number): string {
  const LOOP_WIDTH = 32;
  const right = Math.max(sx, tx) + LOOP_WIDTH;
  return `M ${sx},${sy} L ${right},${sy} L ${right},${ty} L ${tx},${ty}`;
}
