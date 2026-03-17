
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
import { Spline, CornerDownRight, Maximize2, Minimize2, Zap, ZapOff, Network, Loader2 } from 'lucide-react';
import * as api from '@/lib/api';
import { useCollapseState } from '@/hooks/useCollapseState';
import { applyCollapseState } from '@/lib/collapse';
import type { DepthLevel } from '@/types/graph';
import type { DiffCheckResponse } from '@/lib/api';

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
  isDiffMode?: boolean;
  diffResult?: DiffCheckResponse | null;
  isDiffChecking?: boolean;
  hasProgressBar?: boolean;
  onEnterDiffMode?: () => void;
  onExitDiffMode?: () => void;
  highlightedNodeIds?: Set<string> | null;
  savedCollapsedIds?: string[];
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
  isDiffMode,
  diffResult,
  isDiffChecking,
  hasProgressBar,
  onEnterDiffMode,
  onExitDiffMode,
  highlightedNodeIds,
  savedCollapsedIds,
}: GraphCanvasProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [animationsEnabled, setAnimationsEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('truecourse:animations') !== 'off';
  });
  const [edgeStyle, setEdgeStyle] = useState<'bezier' | 'step'>(() => {
    if (typeof window === 'undefined') return 'bezier';
    return (localStorage.getItem('truecourse:edgeStyle') as 'bezier' | 'step') || 'bezier';
  });
  const [focusMode, setFocusMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('truecourse:focusMode') === 'on';
  });
  const [panMode, setPanMode] = useState(true);
  const nodesRef = useRef<Node[]>([]);
  const { fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Collapse state for modules/methods modes
  const { collapsedIds, toggle: toggleCollapseRaw, expandAll: expandAllRaw, collapseAll: collapseAllRaw, isBulkAction } = useCollapseState(repoId, depthLevel, initialNodes, branch, savedCollapsedIds);

  // Save top-level node positions after a delay (lets dagre relayout settle)
  const savePositionsAfterCollapse = useCallback(() => {
    setTimeout(() => {
      const positions: Record<string, { x: number; y: number }> = {};
      for (const node of nodesRef.current) {
        if (node.type === 'layer' || node.type === 'module' || node.type === 'method') continue;
        positions[node.id] = node.position;
      }
      if (Object.keys(positions).length > 0) {
        api.saveGraphPositions(repoId, positions, branch, depthLevel);
      }
    }, 600);
  }, [repoId, branch, depthLevel]);

  // Wrap collapse actions to also save positions
  const toggleCollapse = useCallback((id: string) => {
    toggleCollapseRaw(id);
    savePositionsAfterCollapse();
  }, [toggleCollapseRaw, savePositionsAfterCollapse]);

  const expandAll = useCallback(() => {
    expandAllRaw();
    savePositionsAfterCollapse();
  }, [expandAllRaw, savePositionsAfterCollapse]);

  const collapseAll = useCallback(() => {
    collapseAllRaw();
    savePositionsAfterCollapse();
  }, [collapseAllRaw, savePositionsAfterCollapse]);

  // Keep ref in sync with current nodes
  nodesRef.current = nodes;

  // Count modules per layer for collapsed badge
  const moduleCountByLayer = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of initialNodes) {
      const parentId = (node as Record<string, unknown>).parentId as string | undefined;
      if (parentId && node.type === 'module') {
        counts.set(parentId, (counts.get(parentId) || 0) + 1);
      }
    }
    return counts;
  }, [initialNodes]);

  // Update when initial data changes
  useMemo(() => {
    const isSelected = (id: string) => id === selectedNodeId || id === focusNodeId;
    let processedNodes: Node[];
    if (depthLevel === 'services') {
      processedNodes = initialNodes.map((node) => ({
        ...node,
        selected: isSelected(node.id),
        data: { ...node.data, onExplain: onExplainNode },
      }));
    } else {
      processedNodes = initialNodes.map((node) => {
        // Inject collapse callbacks into layer container nodes
        if (node.type === 'layer' && (node.data as Record<string, unknown>).isContainer) {
          return {
            ...node,
            selected: isSelected(node.id),
            data: {
              ...node.data,
              isCollapsed: collapsedIds.has(node.id),
              onToggleCollapse: toggleCollapse,
              moduleCount: moduleCountByLayer.get(node.id) || 0,
            },
          };
        }
        // Inject collapse callbacks into module container nodes (methods mode)
        if (node.type === 'module' && (node.data as Record<string, unknown>).isContainer) {
          return {
            ...node,
            selected: isSelected(node.id),
            data: {
              ...node.data,
              onExplain: onExplainNode,
              isCollapsed: collapsedIds.has(node.id),
              onToggleCollapse: toggleCollapse,
            },
          };
        }
        if (node.type === 'module' || node.type === 'method') {
          return { ...node, selected: isSelected(node.id), data: { ...node.data, onExplain: onExplainNode } };
        }
        return { ...node, selected: isSelected(node.id) };
      });
    }

    let processedEdges = initialEdges.map((e) => ({ ...e, data: { ...e.data, edgeStyle, hidden: focusMode } }));

    // Apply collapse transform for non-services modes — always relayout to reposition
    if (depthLevel !== 'services') {
      const collapsed = applyCollapseState(processedNodes, processedEdges, collapsedIds, depthLevel, true);
      processedNodes = collapsed.nodes;
      processedEdges = collapsed.edges.map((e) => ({ ...e, data: { ...e.data, edgeStyle, hidden: focusMode } }));
    }

    // Apply path-based edge dimming (same logic as hover, but for a set of highlighted nodes)
    if (highlightedNodeIds && highlightedNodeIds.size > 0) {
      // Find edges connected to highlighted nodes or their children
      const connectedEdgeIds = new Set<string>();
      for (const e of processedEdges) {
        if (highlightedNodeIds.has(e.source) || highlightedNodeIds.has(e.target)) {
          connectedEdgeIds.add(e.id);
        }
      }
      processedEdges = processedEdges.map((e) => ({
        ...e,
        data: {
          ...e.data,
          dimmed: !connectedEdgeIds.has(e.id),
          hidden: focusMode ? !connectedEdgeIds.has(e.id) : e.data?.hidden,
        },
      }));
    }

    setNodes(processedNodes);
    setEdges(processedEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges, onExplainNode, selectedNodeId, focusNodeId, depthLevel, edgeStyle, collapsedIds, toggleCollapse, moduleCountByLayer, focusMode, highlightedNodeIds]);


  const animDuration = animationsEnabled ? 300 : 0;


  // Fit view when depth level changes, new data arrives, or bulk collapse/expand
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      fitView({ padding: 0.3, duration: animDuration });
    });
    return () => cancelAnimationFrame(raf);
  }, [depthLevel, initialNodes, fitView, animDuration]);

  // Zoom to highlighted nodes when file path filter changes, or fit all when cleared
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (highlightedNodeIds && highlightedNodeIds.size > 0) {
        fitView({
          nodes: [...highlightedNodeIds].map((id) => ({ id })),
          padding: 0.3,
          duration: animDuration,
        });
      } else {
        fitView({ padding: 0.3, duration: animDuration });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [highlightedNodeIds, fitView, animDuration]);

  // Fit view on bulk collapse/expand only (not individual toggles)
  useEffect(() => {
    if (!isBulkAction()) return;
    const raf = requestAnimationFrame(() => {
      fitView({ padding: 0.3, duration: animDuration });
    });
    return () => cancelAnimationFrame(raf);
  }, [collapsedIds, fitView, animDuration, isBulkAction]);

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
        fitView({ nodes: nodeIds.map((id) => ({ id })), padding: 0.5, duration: animDuration });
      } else if (node.type === 'module' || node.type === 'method') {
        // For module/method nodes, also show sibling nodes in the same parent
        const parentId = (node as Record<string, unknown>).parentId as string | undefined;
        if (parentId) {
          const siblingIds = nodesRef.current
            .filter((n) => (n as Record<string, unknown>).parentId === parentId)
            .map((n) => n.id);
          fitView({ nodes: [{ id: parentId }, ...siblingIds.map((id) => ({ id }))], padding: 0.3, duration: animDuration });
        } else {
          fitView({ nodes: [{ id: focusNodeId }], padding: 1, duration: animDuration });
        }
      } else {
        fitView({ nodes: [{ id: focusNodeId }], padding: 1.5, duration: animDuration });
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
          fitView({ nodes: [{ id: node.id }], padding: 1.5, duration: animDuration });
        }, 50);
      } else if (node.type === 'serviceGroup') {
        // Zoom to service group and its children (layers, modules, methods)
        const childNodeIds = nodesRef.current
          .filter((n) => (n as Record<string, unknown>).parentId === node.id)
          .map((n) => n.id);
        const nodeIds = [node.id, ...childNodeIds];
        setTimeout(() => {
          fitView({ nodes: nodeIds.map((id) => ({ id })), padding: 0.5, duration: animDuration });
        }, 50);
      } else if (node.type === 'database') {
        // Zoom to database node
        setTimeout(() => {
          fitView({ nodes: [{ id: node.id }], padding: 1.5, duration: animDuration });
        }, 50);
      }
    },
    [onNodeSelect, depthLevel, fitView, animDuration],
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
        return eds.map((e) => ({
          ...e,
          data: {
            ...e.data,
            dimmed: !connectedIds.has(e.id),
            hidden: focusMode ? !connectedIds.has(e.id) : (e.data as Record<string, unknown>)?.hidden,
          },
        }));
      });
    },
    [setEdges, focusMode],
  );

  const onNodeMouseLeave: NodeMouseHandler = useCallback(
    () => {
      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          data: {
            ...e.data,
            dimmed: e.data?.dimmed ? false : e.data?.dimmed,
            hidden: focusMode ? true : false,
          },
        })),
      );
    },
    [setEdges, focusMode],
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect?.(null);
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        data: { ...e.data, dimmed: false, hidden: focusMode },
      })),
    );
    // Clicking pane zooms back to fit all
    fitView({ padding: 0.3, duration: animDuration });
  }, [onNodeSelect, depthLevel, fitView, setEdges, focusMode, animDuration]);

  return (
    <div className={`h-full w-full${animationsEnabled ? '' : ' no-animations'}`}>
      <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 flex items-center gap-2">
        <DepthToggle level={depthLevel} onChange={onDepthChange} />
        {depthLevel !== 'services' && (
          <button
            onClick={() => { collapsedIds.size > 0 ? expandAll() : collapseAll(); }}
            className="flex items-center justify-center rounded-md border border-border bg-card p-1.5 shadow-sm text-muted-foreground hover:text-foreground transition-colors"
            title={collapsedIds.size > 0 ? 'Expand All' : 'Collapse All'}
          >
            {collapsedIds.size > 0 ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
          </button>
        )}
        <button
          onClick={() => setFocusMode((v) => {
            const next = !v;
            localStorage.setItem('truecourse:focusMode', next ? 'on' : 'off');
            return next;
          })}
          className="flex items-center justify-center rounded-md border border-border bg-card p-1.5 shadow-sm text-muted-foreground hover:text-foreground transition-colors"
          title={focusMode ? 'Show all edges' : 'Show edges on hover only'}
        >
          <Network className={`h-3.5 w-3.5 ${focusMode ? 'opacity-40' : ''}`} />
        </button>
        <button
          onClick={() => setEdgeStyle((s) => {
            const next = s === 'bezier' ? 'step' : 'bezier';
            localStorage.setItem('truecourse:edgeStyle', next);
            return next;
          })}
          className="flex items-center justify-center rounded-md border border-border bg-card p-1.5 shadow-sm text-muted-foreground hover:text-foreground transition-colors"
          title={edgeStyle === 'bezier' ? 'Switch to L-shaped edges' : 'Switch to curved edges'}
        >
          {edgeStyle === 'bezier' ? <CornerDownRight className="h-3.5 w-3.5" /> : <Spline className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => setAnimationsEnabled((v) => {
            const next = !v;
            localStorage.setItem('truecourse:animations', next ? 'on' : 'off');
            return next;
          })}
          className="flex items-center justify-center rounded-md border border-border bg-card p-1.5 shadow-sm text-muted-foreground hover:text-foreground transition-colors"
          title={animationsEnabled ? 'Disable animations' : 'Enable animations'}
        >
          {animationsEnabled ? <Zap className="h-3.5 w-3.5" /> : <ZapOff className="h-3.5 w-3.5" />}
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
        nodesDraggable={!panMode}
        elementsSelectable={!panMode}
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
        <ZoomControls onAutoLayout={handleAutoLayout} panMode={panMode} onTogglePanMode={() => setPanMode((v) => !v)} />
      </ReactFlow>

      {/* Diff mode banner */}
      {isDiffMode && !diffResult && !isDiffChecking && (
        <div className={`absolute ${hasProgressBar ? 'bottom-24' : 'bottom-4'} left-1/2 z-20 -translate-x-1/2 rounded-lg border border-amber-500/30 bg-card px-4 py-2.5 shadow-lg text-xs text-muted-foreground`}>
          Diff mode — click <span className="font-medium text-foreground">Analyze</span> to compare pending changes against your last analysis
        </div>
      )}

      {isDiffMode && isDiffChecking && (
        <div className={`absolute ${hasProgressBar ? 'bottom-24' : 'bottom-4'} left-1/2 z-20 -translate-x-1/2 rounded-lg border border-amber-500/30 bg-card px-4 py-2.5 shadow-lg text-xs text-muted-foreground flex items-center gap-2`}>
          <Loader2 className="h-3 w-3 animate-spin" />
          Scanning pending changes...
        </div>
      )}

      {isDiffMode && diffResult && !isDiffChecking && (
        <div className={`absolute ${hasProgressBar ? 'bottom-24' : 'bottom-4'} left-1/2 z-20 -translate-x-1/2 rounded-lg border border-amber-500/30 bg-card px-4 py-2 shadow-lg flex items-center gap-3 text-xs`}>
          <span className="text-amber-500 font-medium">+{diffResult.summary.newCount} new</span>
          <span className="text-emerald-500 font-medium">-{diffResult.summary.resolvedCount} resolved</span>
          <span className="border-l border-border pl-3 text-muted-foreground">
            {diffResult.changedFiles.length} file{diffResult.changedFiles.length !== 1 ? 's' : ''} changed
          </span>
        </div>
      )}

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
