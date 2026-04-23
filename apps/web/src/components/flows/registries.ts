/** Shared React Flow type registries for sequence-diagram rendering.
 *  Both the dashboard's main Flows tab and the ADR Living Fragment import
 *  these so a new node/edge kind is registered once. */
import type { NodeTypes, EdgeTypes } from '@xyflow/react';
import { ParticipantNode } from './nodes/ParticipantNode';
import { AnchorNode } from './nodes/AnchorNode';
import { StepDetailNode } from './nodes/StepDetailNode';
import { StepEdge } from './edges/StepEdge';

export const flowNodeTypes: NodeTypes = {
  participant: ParticipantNode,
  anchor: AnchorNode,
  stepDetail: StepDetailNode,
};

export const flowEdgeTypes: EdgeTypes = {
  step: StepEdge,
};
