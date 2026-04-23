import { useState, useEffect, useCallback, useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Background } from '@xyflow/react';
import { Loader2, Sparkles, Globe, Zap, Clock, Power } from 'lucide-react';
import { FlowPlayer } from './FlowPlayer';
import { flowNodeTypes, flowEdgeTypes } from './registries';
import { buildFlowLayout } from './layout';
import { ZoomControls } from '@/components/graph/controls/ZoomControls';
import { Button } from '@/components/ui/button';
import * as api from '@/lib/api';
import type { FlowDetailResponse, ViolationResponse } from '@/lib/api';

type FlowDiagramPanelProps = {
  repoId: string;
  flowId: string;
  analysisId?: string;
  /** True when the current view is LATEST (dropdown unset AND diff toggle
   *  off). Enrich button only makes sense for LATEST because the result
   *  persists back to LATEST.json. */
  canEnrich?: boolean;
};

function FlowDiagramInner({ repoId, flowId, analysisId, canEnrich }: FlowDiagramPanelProps) {
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
      api.getFlow(repoId, flowId, analysisId),
      api.getViolations(repoId, undefined, analysisId),
    ])
      .then(([flowData, violationData]) => {
        setFlow(flowData);
        setViolations(violationData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load flow'))
      .finally(() => setIsLoading(false));
  }, [repoId, flowId, analysisId]);

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
    return buildFlowLayout<ViolationResponse>({
      steps: flow.steps,
      violationsByTarget,
      playback: { currentStep, isPlaying },
      includeStepDetails: true,
    });
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
          {!flow.description && canEnrich && (
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
          nodeTypes={flowNodeTypes}
          edgeTypes={flowEdgeTypes}
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
          <ZoomControls />
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
