import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  Position,
} from '@xyflow/react';
import { Loader2, Sparkles, ZoomIn, ZoomOut, Maximize2, Globe, Zap, Clock, Power } from 'lucide-react';
import { FlowPlayer } from './FlowPlayer';
import { ParticipantNode } from './nodes/ParticipantNode';
import { AnchorNode } from './nodes/AnchorNode';
import { StepDetailNode } from './nodes/StepDetailNode';
import { StepEdge } from './edges/StepEdge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import * as api from '@/lib/api';
import type { FlowDetailResponse, ViolationResponse } from '@/lib/api';
import { DB_TYPE_COLORS } from '@/lib/database-colors';

const nodeTypes: NodeTypes = {
  participant: ParticipantNode,
  anchor: AnchorNode,
  stepDetail: StepDetailNode,
};

const edgeTypes: EdgeTypes = {
  step: StepEdge,
};

type FlowDiagramPanelProps = {
  repoId: string;
  flowId: string;
};

const COLUMN_WIDTH = 240;
const ROW_HEIGHT_COMPACT = 60;
const ROW_HEIGHT_WITH_DESC = 100;
const HEADER_HEIGHT = 80;
const PADDING_X = 60;
const PADDING_Y = 20;
const PARTICIPANT_WIDTH = 180;

function FlowZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1 rounded-lg border border-border bg-card p-1 shadow-md">
      <Button variant="ghost" size="icon-xs" onClick={() => zoomIn()} aria-label="Zoom in">
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={() => zoomOut()} aria-label="Zoom out">
        <ZoomOut className="h-4 w-4" />
      </Button>
      <Separator />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => fitView({ padding: 0.3, duration: 300 })}
        aria-label="Fit view"
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function FlowDiagramInner({ repoId, flowId }: FlowDiagramPanelProps) {
  const [flow, setFlow] = useState<FlowDetailResponse | null>(null);
  const [violations, setViolations] = useState<ViolationResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnriching, setIsEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setCurrentStep(0);
    setIsPlaying(false);
    Promise.all([
      api.getFlow(repoId, flowId),
      api.getViolations(repoId),
    ])
      .then(([flowData, violationData]) => {
        setFlow(flowData);
        setViolations(violationData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load flow'))
      .finally(() => setIsLoading(false));
  }, [repoId, flowId]);

  const handleEnrich = useCallback(async () => {
    if (!flow) return;
    setIsEnriching(true);
    try {
      const enriched = await api.enrichFlow(repoId, flowId);
      setFlow(enriched);
    } catch {
      // Silently fail enrichment
    } finally {
      setIsEnriching(false);
    }
  }, [repoId, flowId, flow]);

  const handlePlayPause = useCallback(() => {
    if (!flow?.steps?.length) return;
    // If at the end, restart from beginning
    if (!isPlaying && currentStep >= flow.steps.length) {
      setCurrentStep(0);
    }
    setIsPlaying((v) => !v);
  }, [isPlaying, currentStep, flow]);

  // Build a map of violations by method/module/service for quick lookup
  const violationsByTarget = useMemo(() => {
    const map = new Map<string, ViolationResponse[]>();
    for (const v of violations) {
      // Skip code and database violations — they don't map to flow steps
      if (v.type === 'code' || v.type === 'database') continue;

      // Match by method name (most specific)
      if (v.targetMethodName && v.targetModuleName && v.targetServiceName) {
        const key = `${v.targetServiceName}::${v.targetModuleName}::${v.targetMethodName}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(v);
      }
      // Match by module name
      if (v.targetModuleName && v.targetServiceName) {
        const key = `${v.targetServiceName}::${v.targetModuleName}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(v);
      }
      // Match by service name only (service-level violations without module/method)
      if (v.targetServiceName && !v.targetModuleName && !v.targetMethodName) {
        const key = `service::${v.targetServiceName}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(v);
      }
    }
    return map;
  }, [violations]);

  const { nodes, edges } = useMemo(() => {
    if (!flow || !flow.steps?.length) return { nodes: [], edges: [] };

    const steps = [...flow.steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const hasAnyDescription = steps.some((s) => !!s.dataDescription);
    const rowHeight = hasAnyDescription ? ROW_HEIGHT_WITH_DESC : ROW_HEIGHT_COMPACT;

    // Track which services have already had their service-level violations attached
    const serviceViolationAttached = new Set<string>();

    // Collect unique participants (service::module pairs)
    const participantKeys: string[] = [];
    const participantSet = new Set<string>();

    const addParticipant = (service: string, module: string) => {
      const key = `${service}::${module}`;
      if (!participantSet.has(key)) {
        participantSet.add(key);
        participantKeys.push(key);
      }
    };

    for (const step of steps) {
      addParticipant(step.sourceService, step.sourceModule);
      addParticipant(step.targetService, step.targetModule);
    }

    const columnIndex = new Map<string, number>();
    participantKeys.forEach((key, i) => columnIndex.set(key, i));

    // Center of each participant column
    const colCenter = (col: number) => PADDING_X + col * COLUMN_WIDTH + PARTICIPANT_WIDTH / 2;

    // Build participant header nodes
    const nodes: Node[] = participantKeys.map((key, i) => {
      const [service, module] = key.split('::');
      return {
        id: `participant-${key}`,
        type: 'participant',
        position: { x: PADDING_X + i * COLUMN_WIDTH, y: PADDING_Y },
        data: {
          service,
          module,
          height: HEADER_HEIGHT + steps.length * rowHeight + 20,
          dbType: null, // ParticipantNode auto-detects from module field
        },
        draggable: false,
        selectable: false,
      };
    });

    // Build step edges with properly centered anchor nodes
    const edges: Edge[] = steps.map((step, i) => {
      const sourceKey = `${step.sourceService}::${step.sourceModule}`;
      const targetKey = `${step.targetService}::${step.targetModule}`;
      const sourceCol = columnIndex.get(sourceKey) ?? 0;
      const targetCol = columnIndex.get(targetKey) ?? 0;
      const y = HEADER_HEIGHT + PADDING_Y + i * rowHeight + rowHeight / 2;

      const isActive = currentStep > 0 && step.stepOrder <= currentStep;
      const isCurrent = currentStep > 0 && step.stepOrder === currentStep;
      const isPlayed = currentStep > 0 && step.stepOrder < currentStep;

      const srcNodeId = `step-src-${step.stepOrder}`;
      const tgtNodeId = `step-tgt-${step.stepOrder}`;

      const isReverse = targetCol < sourceCol;
      // Place anchors at the center of participant columns
      const srcCenterX = colCenter(sourceCol);
      const tgtCenterX = colCenter(targetCol);

      nodes.push(
        {
          id: srcNodeId,
          type: 'anchor',
          position: { x: srcCenterX, y },
          data: {},
          draggable: false,
          selectable: false,
          sourcePosition: isReverse ? Position.Left : Position.Right,
          targetPosition: isReverse ? Position.Right : Position.Left,
        },
        {
          id: tgtNodeId,
          type: 'anchor',
          position: { x: tgtCenterX, y },
          data: {},
          draggable: false,
          selectable: false,
          sourcePosition: isReverse ? Position.Left : Position.Right,
          targetPosition: isReverse ? Position.Right : Position.Left,
        },
      );

      const methodName = step.targetMethod;
      const typeLabel = step.stepType === 'call' ? '' : ` [${step.stepType}]`;
      const description = step.dataDescription || null;
      const dbColor = (step.stepType === 'db-read' || step.stepType === 'db-write')
        ? (DB_TYPE_COLORS[step.targetModule] || null)
        : null;

      // Attach service-level violations only to the first step in that service
      const serviceViolations = !serviceViolationAttached.has(step.targetService)
        ? (violationsByTarget.get(`service::${step.targetService}`) || [])
        : [];
      if (serviceViolations.length > 0) serviceViolationAttached.add(step.targetService);

      const stepViolations = [
        ...(violationsByTarget.get(`${step.targetService}::${step.targetModule}::${step.targetMethod}`) || []),
        ...(violationsByTarget.get(`${step.targetService}::${step.targetModule}`) || []),
        ...serviceViolations,
      ].filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i);

      // Step detail node — spans between source and target columns, centered
      const leftX = Math.min(srcCenterX, tgtCenterX);
      const rightX = Math.max(srcCenterX, tgtCenterX);
      const spanWidth = rightX - leftX;
      nodes.push({
        id: `step-detail-${step.stepOrder}`,
        type: 'stepDetail',
        position: { x: leftX, y: y + 8 },
        data: {
          methodName: `${methodName}${typeLabel}`,
          description,
          stepType: step.stepType,
          dbColor,
          isAsync: step.isAsync,
          isActive,
          stepOrder: step.stepOrder,
          violations: stepViolations,
          width: spanWidth,
        },
        draggable: false,
        selectable: false,
        style: { zIndex: 10, width: spanWidth },
      });

      return {
        id: `step-${step.stepOrder}`,
        source: srcNodeId,
        target: tgtNodeId,
        type: 'step',
        animated: isCurrent && isPlaying,
        style: {
          opacity: isActive ? 1 : 0.35,
        },
        markerEnd: undefined,
        data: {
          stepType: step.stepType,
          dbColor,
          isAsync: step.isAsync,
          isActive,
          isCurrent,
          isAnimating: isCurrent && isPlaying,
          isPlayed,
          showTrail: currentStep > 0,
          showEndDot: step.stepOrder === steps.length && currentStep >= steps.length && !isPlaying,
        },
      };
    });

    return { nodes, edges };
  }, [flow, currentStep, isPlaying, violationsByTarget]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !flow) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{error || 'Flow not found'}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          {(() => {
            const icons: Record<string, typeof Globe> = { http: Globe, event: Zap, cron: Clock, startup: Power };
            const colors: Record<string, string> = { http: 'text-blue-400', event: 'text-amber-400', cron: 'text-purple-400', startup: 'text-emerald-400' };
            const TriggerIcon = icons[flow.trigger] || Globe;
            return <TriggerIcon className={`h-4 w-4 shrink-0 ${colors[flow.trigger] || 'text-muted-foreground'}`} />;
          })()}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-sm font-semibold">{flow.name}</h2>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{flow.trigger}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{flow.stepCount} steps</span>
            </div>
            {flow.description && (
              <p className="truncate text-xs text-muted-foreground">{flow.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!flow.description && (
            <button
              onClick={handleEnrich}
              disabled={isEnriching}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
              title="Enrich with AI descriptions"
            >
              {isEnriching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Enrich
            </button>
          )}
        </div>
      </div>

      {/* Diagram */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          {/* No background grid — cleaner for sequence diagrams */}
          <FlowZoomControls />
        </ReactFlow>

        {/* Player controls */}
        {flow.steps && flow.steps.length > 0 && (
          <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
            <FlowPlayer
              totalSteps={flow.steps.length}
              currentStep={currentStep}
              onStepChange={setCurrentStep}
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function FlowDiagramPanel(props: FlowDiagramPanelProps) {
  return (
    <ReactFlowProvider>
      <FlowDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
