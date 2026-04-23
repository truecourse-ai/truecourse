/** Shared React Flow type registries for architecture-graph rendering.
 *  The main Graph tab adds serviceGroup + layer on top of this registry
 *  via its own composition; the ADR Living Fragment uses this subset. */
import type { NodeTypes, EdgeTypes } from '@xyflow/react';
import { ServiceNode } from './nodes/ServiceNode';
import { ModuleNode } from './nodes/ModuleNode';
import { DatabaseNode } from './nodes/DatabaseNode';
import { DependencyEdge } from './edges/DependencyEdge';

export const graphNodeTypes: NodeTypes = {
  service: ServiceNode,
  module: ModuleNode,
  database: DatabaseNode,
};

export const graphEdgeTypes: EdgeTypes = {
  dependency: DependencyEdge,
};
