import { memo, useMemo, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background } from '@xyflow/react';
import { MousePointer2, Lock } from 'lucide-react';
import { flowNodeTypes, flowEdgeTypes } from '@/components/flows/registries';
import { buildFlowLayout, type FlowLayoutStep } from '@/components/flows/layout';
import { ZoomControls } from '@/components/graph/controls/ZoomControls';
import type { AdrFragmentSnapshot } from '@/lib/api';

/** Decision-time snapshot of a flow, rendered with the same React Flow
 *  node + edge components + layout math as the main Flows tab. Interaction
 *  is off by default so page scroll passes through; click the chip to opt
 *  into pan/zoom. */
function AdrFlowFragmentDiagramInner({
  snapshot,
  fillHeight,
}: {
  snapshot: AdrFragmentSnapshot;
  fillHeight?: boolean;
}) {
  const [interactive, setInteractive] = useState(false);

  const { nodes, edges, height } = useMemo(() => {
    if (snapshot.kind !== 'flow') return { nodes: [], edges: [], height: 200 };
    // New captures include module + method so we render at the same
    // granularity as the main Flows tab. Fall back to service-as-module
    // for older snapshots that predate the schema bump.
    const steps: FlowLayoutStep[] = snapshot.steps.map((s) => ({
      stepOrder: s.stepOrder,
      sourceService: s.sourceService,
      sourceModule: s.sourceModule ?? s.sourceService,
      targetService: s.targetService,
      targetModule: s.targetModule ?? s.targetService,
      targetMethod: s.targetMethod,
      stepType: s.stepType,
      isAsync: s.isAsync,
      dataDescription: s.dataDescription,
    }));
    return buildFlowLayout({ steps, includeStepDetails: true });
  }, [snapshot]);

  return (
    <div
      className={`relative overflow-hidden rounded-md border border-primary/30 bg-card ${
        fillHeight ? 'h-full' : 'my-3'
      }`}
      style={
        fillHeight ? undefined : { height: Math.max(220, Math.min(height, 560)) }
      }
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        edgeTypes={flowEdgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.5}
        maxZoom={2}
        nodesDraggable={interactive}
        nodesConnectable={false}
        elementsSelectable={interactive}
        panOnScroll={false}
        zoomOnScroll={interactive}
        zoomOnDoubleClick={interactive}
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
          {/* Same zoom controls as the main Flows tab. No pan/select or
              auto-layout — sequence-diagram positions are structurally
              fixed (columns + step rows), dragging or relaying out would
              break the diagram's meaning. */}
          <ZoomControls />
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

export const AdrFlowFragmentDiagram = memo(function AdrFlowFragmentDiagram(props: {
  snapshot: AdrFragmentSnapshot;
  fillHeight?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <AdrFlowFragmentDiagramInner snapshot={props.snapshot} fillHeight={props.fillHeight} />
    </ReactFlowProvider>
  );
});
