'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ServiceNode } from '@/components/graph/nodes/ServiceNode';
import { DependencyEdge } from '@/components/graph/edges/DependencyEdge';
import { ZoomControls } from '@/components/graph/controls/ZoomControls';
import * as api from '@/lib/api';
import type { GraphNode, GraphEdge } from '@/types/graph';

type GraphCanvasProps = {
  initialNodes: GraphNode[];
  initialEdges: GraphEdge[];
  onNodeSelect?: (nodeId: string | null) => void;
  onExplainNode?: (nodeId: string) => void;
  selectedNodeId?: string | null;
  repoId: string;
  branch?: string;
  onRefetch?: () => void;
};

const nodeTypes: NodeTypes = {
  service: ServiceNode as unknown as NodeTypes[string],
};

const edgeTypes: EdgeTypes = {
  dependency: DependencyEdge as unknown as EdgeTypes[string],
};

export function GraphCanvas({
  initialNodes,
  initialEdges,
  onNodeSelect,
  onExplainNode,
  selectedNodeId,
  repoId,
  branch,
  onRefetch,
}: GraphCanvasProps) {
  const [isSaving, setIsSaving] = useState(false);
  const nodesRef = useRef<Node[]>([]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Keep ref in sync with current nodes
  nodesRef.current = nodes;

  // Update when initial data changes (positions come from the API already applied)
  useMemo(() => {
    const nodesWithCallbacks = initialNodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: { ...node.data, onExplain: onExplainNode },
    }));
    setNodes(nodesWithCallbacks);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges, onExplainNode, selectedNodeId]);

  const onNodeDragStop = useCallback(
    () => {
      const positions: Record<string, { x: number; y: number }> = {};
      for (const node of nodesRef.current) {
        positions[node.id] = node.position;
      }
      setIsSaving(true);
      api.saveGraphPositions(repoId, positions, branch)
        .finally(() => setIsSaving(false));
    },
    [repoId, branch],
  );

  const handleAutoLayout = useCallback(() => {
    api.resetGraphPositions(repoId, branch)
      .then(() => onRefetch?.())
      .catch(() => {});
  }, [repoId, branch, onRefetch]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onNodeSelect?.(node.id);
    },
    [onNodeSelect],
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect?.(null);
  }, [onNodeSelect]);


  return (
    <div className="h-full w-full">
      {isSaving && (
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
          Saving...
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <MiniMap
          nodeStrokeWidth={3}
          className="!bg-card !border-border"
          maskColor="rgba(0, 0, 0, 0.1)"
        />
        <ZoomControls onAutoLayout={handleAutoLayout} />
      </ReactFlow>
    </div>
  );
}
