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
import { Spline, CornerDownRight } from 'lucide-react';
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
  focusNodeId?: string | null;
  focusKey?: number;
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
  focusNodeId,
  focusKey,
}: GraphCanvasProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [edgeStyle, setEdgeStyle] = useState<'bezier' | 'step'>(() => {
    if (typeof window === 'undefined') return 'bezier';
    return (localStorage.getItem(`truecourse:edgeStyle:${depthLevel}`) as 'bezier' | 'step') || 'bezier';
  });
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
    setEdges(initialEdges.map((e) => ({ ...e, data: { ...e.data, edgeStyle } })));
  }, [initialNodes, initialEdges, setNodes, setEdges, onExplainNode, selectedNodeId, depthLevel, edgeStyle]);

  // Load saved edge style when depth level changes
  useEffect(() => {
    const saved = localStorage.getItem(`truecourse:edgeStyle:${depthLevel}`) as 'bezier' | 'step' | null;
    setEdgeStyle(saved || 'bezier');
  }, [depthLevel]);

  // Fit view when depth level changes or new data arrives
  useEffect(() => {
    // Use requestAnimationFrame to wait for ReactFlow to measure nodes
    const raf = requestAnimationFrame(() => {
      fitView({ padding: 0.3 });
    });
    return () => cancelAnimationFrame(raf);
  }, [depthLevel, initialNodes, fitView]);

  // Focus on a specific node when requested from insights panel
  useEffect(() => {
    if (!focusNodeId) return;

    const node = nodesRef.current.find((n) => n.id === focusNodeId);
    if (!node) return;

    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === focusNodeId })));

    setTimeout(() => {
      if (node.type === 'serviceGroup') {
        const childNodeIds = nodesRef.current
          .filter((n) => (n as Record<string, unknown>).parentId === node.id)
          .map((n) => n.id);
        const nodeIds = [node.id, ...childNodeIds];
        fitView({ nodes: nodeIds.map((id) => ({ id })), padding: 0.5, duration: 300 });
      } else if (node.type === 'module' || node.type === 'method') {
        // For module/method nodes, also show sibling nodes in the same parent
        const parentId = (node as Record<string, unknown>).parentId as string | undefined;
        if (parentId) {
          const siblingIds = nodesRef.current
            .filter((n) => (n as Record<string, unknown>).parentId === parentId)
            .map((n) => n.id);
          fitView({ nodes: [{ id: parentId }, ...siblingIds.map((id) => ({ id }))], padding: 0.3, duration: 300 });
        } else {
          fitView({ nodes: [{ id: focusNodeId }], padding: 1, duration: 300 });
        }
      } else {
        fitView({ nodes: [{ id: focusNodeId }], padding: 1.5, duration: 300 });
      }
    }, 50);
  }, [focusKey, focusNodeId, fitView, setNodes]);

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

  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (_event, node) => {
      setEdges((eds) => {
        const connectedIds = new Set<string>();
        for (const e of eds) {
          if (e.source === node.id || e.target === node.id) {
            connectedIds.add(e.id);
          }
        }
        // Also include edges connected to children (for serviceGroup/layer/module containers)
        const childIds = new Set(
          nodesRef.current
            .filter((n) => (n as Record<string, unknown>).parentId === node.id)
            .map((n) => n.id),
        );
        for (const e of eds) {
          if (childIds.has(e.source) || childIds.has(e.target)) {
            connectedIds.add(e.id);
          }
        }
        if (connectedIds.size === 0) return eds;
        return eds.map((e) => ({
          ...e,
          data: { ...e.data, dimmed: !connectedIds.has(e.id) },
        }));
      });
    },
    [setEdges],
  );

  const onNodeMouseLeave: NodeMouseHandler = useCallback(
    () => {
      setEdges((eds) =>
        eds.map((e) =>
          e.data?.dimmed ? { ...e, data: { ...e.data, dimmed: false } } : e,
        ),
      );
    },
    [setEdges],
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect?.(null);
    setEdges((eds) =>
      eds.map((e) =>
        e.data?.dimmed ? { ...e, data: { ...e.data, dimmed: false } } : e,
      ),
    );
    // Clicking pane zooms back to fit all
    fitView({ padding: 0.3, duration: 300 });
  }, [onNodeSelect, depthLevel, fitView, setEdges]);

  return (
    <div className="h-full w-full">
      <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 flex items-center gap-2">
        <DepthToggle level={depthLevel} onChange={onDepthChange} />
        <button
          onClick={() => setEdgeStyle((s) => {
            const next = s === 'bezier' ? 'step' : 'bezier';
            localStorage.setItem(`truecourse:edgeStyle:${depthLevel}`, next);
            return next;
          })}
          className="flex items-center justify-center rounded-md border border-border bg-card p-1.5 shadow-sm text-muted-foreground hover:text-foreground transition-colors"
          title={edgeStyle === 'bezier' ? 'Switch to L-shaped edges' : 'Switch to curved edges'}
        >
          {edgeStyle === 'bezier' ? <CornerDownRight className="h-3.5 w-3.5" /> : <Spline className="h-3.5 w-3.5" />}
        </button>
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
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
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
