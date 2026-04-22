import { memo, useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useEdgesState,
  useNodesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import { MousePointer2, Lock } from 'lucide-react';
import { graphNodeTypes, graphEdgeTypes } from '@/components/graph/registries';
import { layoutNodesWithDagre } from '@/components/graph/layout';
import { GRAPH_NODE_DIMENSIONS } from '@/components/graph/dimensions';
import {
  buildDatabaseNodeData,
  buildModuleNodeData,
  buildServiceNodeData,
} from '@/components/graph/node-builders';
import { ZoomControls } from '@/components/graph/controls/ZoomControls';
import type { AdrFragmentSnapshot } from '@/lib/api';

/** Decision-time snapshot of a sub-graph, rendered with the same React Flow
 *  node + edge components as the main Graph tab and laid out with the
 *  shared dagre primitive so the visual language stays consistent. Default
 *  non-interactive — click the chip to enable pan/zoom. */
// Matches the main Graph tab's server-side dagre settings
// (`computeDagreLayout` in apps/server/src/services/graph.service.ts) so
// the ADR graph snapshot doesn't overlap where the main graph wouldn't.
const DAGRE_OPTS = {
  rankdir: 'TB' as const,
  ranksep: 200,
  nodesep: 150,
  marginx: 60,
  marginy: 60,
  defaultNodeWidth: GRAPH_NODE_DIMENSIONS.service.width,
  defaultNodeHeight: GRAPH_NODE_DIMENSIONS.service.height,
};

function AdrGraphFragmentDiagramInner({ snapshot }: { snapshot: AdrFragmentSnapshot }) {
  const [interactive, setInteractive] = useState(false);
  // When interactive, panMode=true → drag-canvas-to-pan; panMode=false →
  // drag nodes to reposition. Matches the main Graph tab's toggle.
  const [panMode, setPanMode] = useState(true);
  const canSelect = interactive && !panMode;

  // Nodes held in state so select-mode drags persist and the auto-layout
  // button ("reorder") can rerun dagre without a remount.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (snapshot.kind !== 'graph') {
      setNodes([]);
      setEdges([]);
      return;
    }

    // Snapshot edges reference nodes by NAME, so use name as the React Flow
    // node id. Safe because names are unique within a snapshot. Rich fields
    // on the snapshot (framework / layers / fileCount / dependencyType) are
    // threaded into the same ServiceNodeData shape the main Graph tab uses
    // so visual treatment is identical.
    // Same node-data builders as the main Graph tab (`useGraph.ts`) so
    // ServiceNode / DatabaseNode / ModuleNode render at pixel parity.
    // NO `style.width` — main graph doesn't set one either; the node
    // components size themselves from their own `min-w-…` +
    // `max-w-[240px]` rules. Forcing a width here would make ADR nodes
    // wider than main-graph nodes for the same service.
    const rfNodes: Node[] = snapshot.nodes.map((n) => {
      if (n.kind === 'service') {
        return {
          id: n.name,
          type: 'service',
          position: { x: 0, y: 0 },
          data: buildServiceNodeData({
            label: n.name,
            description: n.description,
            serviceType: n.serviceType,
            framework: n.framework,
            fileCount: n.fileCount,
            layers: n.layers,
            rootPath: n.rootPath,
          }),
        };
      }
      if (n.kind === 'database') {
        return {
          id: n.name,
          type: 'database',
          position: { x: 0, y: 0 },
          data: buildDatabaseNodeData({
            label: n.name,
            databaseType: n.databaseType,
            tableCount: n.tableCount,
            connectedServices: n.connectedServices,
          }),
        };
      }
      return {
        id: n.name,
        type: 'module',
        position: { x: 0, y: 0 },
        data: buildModuleNodeData({
          label: n.name,
          moduleKind: n.moduleKind,
          methodCount: n.methodCount,
        }),
        draggable: false,
      };
    });

    const rfEdges: Edge[] = snapshot.edges.map((e, i) => {
      const isHttp = e.dependencyType === 'http';
      const count = e.count ?? 0;
      const label = isHttp
        ? `${count} HTTP call${count === 1 ? '' : 's'}`
        : e.dependencyType === 'database'
          ? ''
          : count > 0
            ? `${count} import${count === 1 ? '' : 's'}`
            : '';
      return {
        id: `e-${i}-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        type: 'dependency',
        sourceHandle: 'bottom',
        targetHandle: 'top',
        data: {
          dependencyCount: count,
          hasHttpCalls: isHttp,
          isViolation: false,
          label,
        },
      };
    });

    const positioned = layoutNodesWithDagre(rfNodes, rfEdges, DAGRE_OPTS);
    setNodes(positioned);
    setEdges(rfEdges);
  }, [snapshot, setNodes, setEdges]);

  const handleAutoLayout = useCallback(() => {
    setNodes((current) => layoutNodesWithDagre(current, edges, DAGRE_OPTS));
  }, [edges, setNodes]);

  return (
    <div className="relative my-3 h-[520px] overflow-hidden rounded-md border border-primary/30 bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={graphNodeTypes}
        edgeTypes={graphEdgeTypes}
        fitView
        // Cap fit-view so text never renders smaller (or larger) than the
        // main Graph tab. Small graphs fit fully at 1x; bigger graphs get
        // clipped and the reader pans (in pan mode) to see the rest.
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.5}
        maxZoom={2}
        nodesDraggable={canSelect}
        nodesConnectable={false}
        elementsSelectable={canSelect}
        panOnScroll={false}
        zoomOnScroll={interactive}
        zoomOnDoubleClick={interactive}
        // Pane drag always pans when interactive — same as the main
        // Graph tab (which relies on React Flow's default panOnDrag).
        // Dragging a node moves it in grab mode; dragging the empty pane
        // pans in both modes.
        panOnDrag={interactive}
        preventScrolling={interactive}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
      </ReactFlow>
      {!interactive ? (
        <button
          type="button"
          onClick={() => setInteractive(true)}
          className="absolute inset-0 flex cursor-pointer items-end justify-end bg-transparent p-2"
          aria-label="Enable diagram interaction"
        >
          <span className="flex items-center gap-1 rounded-md border border-border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur hover:text-foreground">
            <MousePointer2 className="h-3 w-3" /> click to interact
          </span>
        </button>
      ) : (
        <>
          {/* Same zoom + pan/select + auto-layout controls as the main
              Graph tab so the reader's muscle memory carries over. Lock
              button is separate because it's specific to the ADR embed. */}
          <ZoomControls
            panMode={panMode}
            onTogglePanMode={() => setPanMode((v) => !v)}
            onAutoLayout={handleAutoLayout}
          />
          <button
            type="button"
            onClick={() => setInteractive(false)}
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md border border-border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
            aria-label="Lock diagram"
            title="Lock — page scroll passes through"
          >
            <Lock className="h-3 w-3" /> lock
          </button>
        </>
      )}
    </div>
  );
}

export const AdrGraphFragmentDiagram = memo(function AdrGraphFragmentDiagram(props: {
  snapshot: AdrFragmentSnapshot;
}) {
  return (
    <ReactFlowProvider>
      <AdrGraphFragmentDiagramInner snapshot={props.snapshot} />
    </ReactFlowProvider>
  );
});
