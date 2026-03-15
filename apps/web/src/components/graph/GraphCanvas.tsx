'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ServiceNode } from '@/components/graph/nodes/ServiceNode';
import { LayerNode } from '@/components/graph/nodes/LayerNode';
import { ServiceGroupNode } from '@/components/graph/nodes/ServiceGroupNode';
import { DatabaseNode } from '@/components/graph/nodes/DatabaseNode';
import { ModuleNode } from '@/components/graph/nodes/ModuleNode';
import { MethodNode } from '@/components/graph/nodes/MethodNode';
import { DependencyEdge } from '@/components/graph/edges/DependencyEdge';
import { IntraLayerEdge } from '@/components/graph/edges/IntraLayerEdge';
import { DatabaseEdge } from '@/components/graph/edges/DatabaseEdge';
import { ZoomControls } from '@/components/graph/controls/ZoomControls';
import { DepthToggle } from '@/components/graph/controls/DepthToggle';
import * as api from '@/lib/api';
import type { DepthLevel } from '@/types/graph';

type GraphCanvasProps = {
  initialNodes: Node[];
  initialEdges: Edge[];
  onNodeSelect?: (nodeId: string | null) => void;
  onExplainNode?: (nodeId: string) => void;
  selectedNodeId?: string | null;
  repoId: string;
  branch?: string;
  onRefetch?: () => void;
  depthLevel: DepthLevel;
  onDepthChange: (level: DepthLevel) => void;
};

const nodeTypes: NodeTypes = {
  service: ServiceNode as unknown as NodeTypes[string],
  layer: LayerNode as unknown as NodeTypes[string],
  serviceGroup: ServiceGroupNode as unknown as NodeTypes[string],
  database: DatabaseNode as unknown as NodeTypes[string],
  module: ModuleNode as unknown as NodeTypes[string],
  method: MethodNode as unknown as NodeTypes[string],
};

const edgeTypes: EdgeTypes = {
  dependency: DependencyEdge as unknown as EdgeTypes[string],
  violation: DependencyEdge as unknown as EdgeTypes[string],
  intraLayer: IntraLayerEdge as unknown as EdgeTypes[string],
  database: DatabaseEdge as unknown as EdgeTypes[string],
};

function GraphCanvasInner({
  initialNodes,
  initialEdges,
  onNodeSelect,
  onExplainNode,
  selectedNodeId,
  repoId,
  branch,
  onRefetch,
  depthLevel,
  onDepthChange,
}: GraphCanvasProps) {
  const [isSaving, setIsSaving] = useState(false);
  const nodesRef = useRef<Node[]>([]);
  const prevDepthRef = useRef(depthLevel);
  const { fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Keep ref in sync with current nodes
  nodesRef.current = nodes;

  // Update when initial data changes
  useMemo(() => {
    if (depthLevel === 'services') {
      const nodesWithCallbacks = initialNodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
        data: { ...node.data, onExplain: onExplainNode },
      }));
      setNodes(nodesWithCallbacks);
    } else {
      const nodesWithCallbacks = initialNodes.map((node) => {
        if (node.type === 'module' || node.type === 'method') {
          return { ...node, selected: node.id === selectedNodeId, data: { ...node.data, onExplain: onExplainNode } };
        }
        return { ...node, selected: node.id === selectedNodeId };
      });
      setNodes(nodesWithCallbacks);
    }
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges, onExplainNode, selectedNodeId, depthLevel]);

  // Fit view when depth level changes or new data arrives
  useEffect(() => {
    // Use requestAnimationFrame to wait for ReactFlow to measure nodes
    const raf = requestAnimationFrame(() => {
      fitView({ padding: 0.3 });
    });
    return () => cancelAnimationFrame(raf);
  }, [depthLevel, initialNodes, fitView]);

  const onNodeDragStop = useCallback(
    () => {
      const positions: Record<string, { x: number; y: number }> = {};
      for (const node of nodesRef.current) {
        // Only save top-level draggable positions (service groups and databases)
        if (node.type === 'layer' || node.type === 'module' || node.type === 'method') continue;
        positions[node.id] = node.position;
      }
      if (Object.keys(positions).length === 0) return;
      setIsSaving(true);
      api.saveGraphPositions(repoId, positions, branch, depthLevel)
        .finally(() => setIsSaving(false));
    },
    [repoId, branch, depthLevel],
  );

  const handleAutoLayout = useCallback(() => {
    api.resetGraphPositions(repoId, branch, depthLevel)
      .then(() => onRefetch?.())
      .catch(() => {});
  }, [repoId, branch, depthLevel, onRefetch]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onNodeSelect?.(node.id);

      if (depthLevel === 'services') {
        // Zoom to clicked service or database node
        setTimeout(() => {
          fitView({ nodes: [{ id: node.id }], padding: 1.5, duration: 300 });
        }, 50);
      } else if (node.type === 'serviceGroup') {
        // Zoom to service group and its children (layers, modules, methods)
        const childNodeIds = nodesRef.current
          .filter((n) => (n as Record<string, unknown>).parentId === node.id)
          .map((n) => n.id);
        const nodeIds = [node.id, ...childNodeIds];
        setTimeout(() => {
          fitView({ nodes: nodeIds.map((id) => ({ id })), padding: 0.5, duration: 300 });
        }, 50);
      } else if (node.type === 'database') {
        // Zoom to database node
        setTimeout(() => {
          fitView({ nodes: [{ id: node.id }], padding: 1.5, duration: 300 });
        }, 50);
      }
    },
    [onNodeSelect, depthLevel, fitView],
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect?.(null);
    // Clicking pane zooms back to fit all
    fitView({ padding: 0.3, duration: 300 });
  }, [onNodeSelect, depthLevel, fitView]);

  return (
    <div className="h-full w-full">
      <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
        <DepthToggle level={depthLevel} onChange={onDepthChange} />
        {isSaving && (
          <div className="mt-2 rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm text-center">
            Saving...
          </div>
        )}
      </div>
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

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
