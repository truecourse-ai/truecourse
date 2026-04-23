/**
 * Sequence-diagram layout for flows. Pure function — takes flow step data +
 * optional overlay state (violations, playback) and returns React Flow
 * `nodes` + `edges` with absolute positions set.
 *
 * Used by both the dashboard's main Flows tab (`FlowDiagramPanel`) and the
 * ADR Living Fragment renderer (`AdrFlowFragmentDiagram`) so there's one
 * source of truth for participant columns, step anchors, edge routing, and
 * step-detail positioning. Previously duplicated byte-for-byte.
 */
import { Position, type Node, type Edge } from '@xyflow/react';
import { DB_TYPE_COLORS } from '@/lib/database-colors';

export type FlowLayoutStep = {
  stepOrder: number;
  sourceService: string;
  sourceModule: string;
  targetService: string;
  targetModule: string;
  /** Optional — only main flow carries method names; ADR snapshots don't. */
  targetMethod?: string;
  stepType: string;
  isAsync?: boolean;
  dataDescription?: string | null;
};

export type FlowLayoutViolation = { id: string; severity: string };

export type FlowLayoutOptions<V extends FlowLayoutViolation = FlowLayoutViolation> = {
  steps: ReadonlyArray<FlowLayoutStep>;
  /** Violations grouped by match key. Keys are
   *  `service::module::method`, `service::module`, and `service::<name>`.
   *  Caller builds the map; layout only does lookups. Defaults to empty. */
  violationsByTarget?: Map<string, V[]>;
  /** Playback state. When omitted, all steps render as "active, not
   *  current, not playing" — appropriate for static ADR snapshots. */
  playback?: { currentStep: number; isPlaying: boolean };
  /** Add a `stepDetail` node per step with method name, description,
   *  violation overlays. Dashboard passes true; ADR fragment omits it
   *  because the snapshot has no method names or descriptions. */
  includeStepDetails?: boolean;
  /** Geometry overrides — default to the dashboard constants so both
   *  consumers look identical unless a caller explicitly tightens. */
  columnWidth?: number;
  rowHeightCompact?: number;
  rowHeightWithDesc?: number;
  headerHeight?: number;
  paddingX?: number;
  paddingY?: number;
  participantWidth?: number;
};

export type FlowLayoutResult = {
  nodes: Node[];
  edges: Edge[];
  width: number;
  height: number;
};

const DEFAULTS = {
  columnWidth: 240,
  rowHeightCompact: 60,
  rowHeightWithDesc: 100,
  headerHeight: 80,
  paddingX: 60,
  paddingY: 20,
  participantWidth: 180,
};

export function buildFlowLayout<V extends FlowLayoutViolation = FlowLayoutViolation>(
  opts: FlowLayoutOptions<V>,
): FlowLayoutResult {
  const {
    steps: rawSteps,
    violationsByTarget = new Map<string, V[]>(),
    playback,
    includeStepDetails = false,
  } = opts;

  const columnWidth = opts.columnWidth ?? DEFAULTS.columnWidth;
  const rowHeightCompact = opts.rowHeightCompact ?? DEFAULTS.rowHeightCompact;
  const rowHeightWithDesc = opts.rowHeightWithDesc ?? DEFAULTS.rowHeightWithDesc;
  const headerHeight = opts.headerHeight ?? DEFAULTS.headerHeight;
  const paddingX = opts.paddingX ?? DEFAULTS.paddingX;
  const paddingY = opts.paddingY ?? DEFAULTS.paddingY;
  const participantWidth = opts.participantWidth ?? DEFAULTS.participantWidth;

  const hasPlayback = playback !== undefined;
  const currentStep = playback?.currentStep ?? 0;
  const isPlaying = playback?.isPlaying ?? false;

  if (rawSteps.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const steps = [...rawSteps].sort((a, b) => a.stepOrder - b.stepOrder);
  const hasAnyDescription = steps.some((s) => !!s.dataDescription);
  const rowHeight = hasAnyDescription ? rowHeightWithDesc : rowHeightCompact;

  // Unique participants keyed by `service::module` in first-seen order.
  const participantKeys: string[] = [];
  const seen = new Set<string>();
  const addParticipant = (service: string, module: string) => {
    const key = `${service}::${module}`;
    if (!seen.has(key)) {
      seen.add(key);
      participantKeys.push(key);
    }
  };
  for (const step of steps) {
    addParticipant(step.sourceService, step.sourceModule);
    addParticipant(step.targetService, step.targetModule);
  }
  const columnIndex = new Map<string, number>();
  participantKeys.forEach((key, i) => columnIndex.set(key, i));
  const colCenter = (col: number) => paddingX + col * columnWidth + participantWidth / 2;

  const lifelineHeight = headerHeight + steps.length * rowHeight + 20;

  const nodes: Node[] = participantKeys.map((key, i) => {
    const [service, module] = key.split('::');
    return {
      id: `participant-${key}`,
      type: 'participant',
      position: { x: paddingX + i * columnWidth, y: paddingY },
      data: {
        service,
        module,
        height: lifelineHeight,
        dbType: null,
      },
      draggable: false,
      selectable: false,
    };
  });

  // Track which services have had their service-level violations attached
  // (so they only appear on the first step that targets that service).
  const serviceViolationAttached = new Set<string>();

  const edges: Edge[] = steps.map((step, i) => {
    const sourceKey = `${step.sourceService}::${step.sourceModule}`;
    const targetKey = `${step.targetService}::${step.targetModule}`;
    const sourceCol = columnIndex.get(sourceKey) ?? 0;
    const targetCol = columnIndex.get(targetKey) ?? 0;
    const y = headerHeight + paddingY + i * rowHeight + rowHeight / 2;

    // Without a playback state (static ADR snapshot), treat every step
    // as active so edges render in their real color instead of the
    // dimmed "not-yet-played" grey.
    const isActive = hasPlayback ? currentStep > 0 && step.stepOrder <= currentStep : true;
    const isCurrent = hasPlayback && currentStep > 0 && step.stepOrder === currentStep;
    const isPlayed = hasPlayback && currentStep > 0 && step.stepOrder < currentStep;

    const srcNodeId = `step-src-${step.stepOrder}`;
    const tgtNodeId = `step-tgt-${step.stepOrder}`;
    const isReverse = targetCol < sourceCol;
    const isSelf = sourceKey === targetKey;
    const srcCenterX = colCenter(sourceCol);
    const tgtCenterX = colCenter(targetCol);
    // Self-calls: offset target anchor slightly below source so StepEdge
    // has the information needed to draw a UML-style loop (arrow out,
    // down, and back into the lifeline) instead of a zero-length edge.
    const SELF_CALL_DY = 18;
    const srcAnchorY = y;
    const tgtAnchorY = isSelf ? y + SELF_CALL_DY : y;

    nodes.push(
      {
        id: srcNodeId,
        type: 'anchor',
        position: { x: srcCenterX, y: srcAnchorY },
        data: {},
        draggable: false,
        selectable: false,
        // For self-calls both handles point right so the path leaves
        // and returns from the same side of the lifeline.
        sourcePosition: isSelf ? Position.Right : isReverse ? Position.Left : Position.Right,
        targetPosition: isSelf ? Position.Right : isReverse ? Position.Right : Position.Left,
      },
      {
        id: tgtNodeId,
        type: 'anchor',
        position: { x: tgtCenterX, y: tgtAnchorY },
        data: {},
        draggable: false,
        selectable: false,
        sourcePosition: isSelf ? Position.Right : isReverse ? Position.Left : Position.Right,
        targetPosition: isSelf ? Position.Right : isReverse ? Position.Right : Position.Left,
      },
    );

    const dbColor =
      step.stepType === 'db-read' || step.stepType === 'db-write'
        ? DB_TYPE_COLORS[step.targetModule] || null
        : null;

    if (includeStepDetails) {
      const serviceViolations = !serviceViolationAttached.has(step.targetService)
        ? violationsByTarget.get(`service::${step.targetService}`) ?? []
        : [];
      if (serviceViolations.length > 0) serviceViolationAttached.add(step.targetService);

      const methodKey = step.targetMethod
        ? `${step.targetService}::${step.targetModule}::${step.targetMethod}`
        : '';
      const stepViolations = [
        ...(methodKey ? violationsByTarget.get(methodKey) ?? [] : []),
        ...(violationsByTarget.get(`${step.targetService}::${step.targetModule}`) ?? []),
        ...serviceViolations,
      ].filter((v, idx, arr) => arr.findIndex((x) => x.id === v.id) === idx);

      const typeLabel = step.stepType === 'call' ? '' : ` [${step.stepType}]`;
      const leftX = Math.min(srcCenterX, tgtCenterX);
      const rightX = Math.max(srcCenterX, tgtCenterX);
      // For self-calls the two anchors are stacked at the same X so
      // spanWidth would be 0. Offset the detail node to the right of the
      // self-loop (LOOP_WIDTH=32 in StepEdge + a little gap) and give it
      // a default width so the method name stays readable.
      const SELF_DETAIL_OFFSET = 44;
      const SELF_DETAIL_WIDTH = 200;
      const spanWidth = isSelf ? SELF_DETAIL_WIDTH : rightX - leftX;
      const detailX = isSelf ? srcCenterX + SELF_DETAIL_OFFSET : leftX;
      nodes.push({
        id: `step-detail-${step.stepOrder}`,
        type: 'stepDetail',
        position: { x: detailX, y: y + 8 },
        data: {
          methodName: step.targetMethod
            ? `${step.targetMethod}${typeLabel}`
            : step.stepType,
          description: step.dataDescription ?? null,
          stepType: step.stepType,
          dbColor,
          isAsync: step.isAsync ?? false,
          isActive,
          stepOrder: step.stepOrder,
          violations: stepViolations,
          width: spanWidth,
        },
        draggable: false,
        selectable: false,
        style: { zIndex: 10, width: spanWidth },
      });
    }

    return {
      id: `step-${step.stepOrder}`,
      source: srcNodeId,
      target: tgtNodeId,
      type: 'step',
      animated: isCurrent && isPlaying,
      style: { opacity: isActive ? 1 : 0.35 },
      data: {
        stepType: step.stepType,
        dbColor,
        isAsync: step.isAsync ?? false,
        isActive,
        isCurrent,
        isAnimating: isCurrent && isPlaying,
        isPlayed,
        showTrail: hasPlayback && currentStep > 0,
        showEndDot:
          hasPlayback &&
          step.stepOrder === steps.length &&
          currentStep >= steps.length &&
          !isPlaying,
        isSelf,
      },
    };
  });

  const width = paddingX * 2 + participantKeys.length * columnWidth;
  const height = lifelineHeight + paddingY;
  return { nodes, edges, width, height };
}
