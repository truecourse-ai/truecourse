import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import type { DepthLevel } from '@/types/graph';

const COLLAPSED_HEIGHT = 32;
const COLLAPSED_WIDTH = 260;

/**
 * Pure function that applies collapse state to nodes and edges.
 * Hides children of collapsed containers, resizes containers,
 * shifts subsequent nodes, and promotes edges.
 */
export function applyCollapseState(
  nodes: Node[],
  edges: Edge[],
  collapsedIds: Set<string>,
  depthLevel: DepthLevel,
  relayout = false,
): { nodes: Node[]; edges: Edge[] } {
  if (depthLevel === 'services') {
    return { nodes, edges };
  }
  if (collapsedIds.size === 0 && !relayout) {
    return { nodes, edges };
  }

  // Build parent-child maps
  const nodeMap = new Map<string, Node>();
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
    const parentId = (node as Record<string, unknown>).parentId as string | undefined;
    if (parentId) {
      const list = childrenOf.get(parentId) || [];
      list.push(node.id);
      childrenOf.set(parentId, list);
    }
  }

  // Step 1: Determine hidden node IDs
  const hiddenIds = new Set<string>();
  function hideDescendants(parentId: string) {
    const children = childrenOf.get(parentId) || [];
    for (const childId of children) {
      hiddenIds.add(childId);
      hideDescendants(childId);
    }
  }
  for (const id of collapsedIds) {
    hideDescendants(id);
  }

  // Step 2: Compute height/width deltas and shift subsequent nodes
  const serviceGroups = nodes.filter((n) => n.type === 'serviceGroup');
  const heightDeltas = new Map<string, number>();
  const yShifts = new Map<string, number>();
  const collapsedWidthNodes = new Set<string>(); // nodes that should shrink width

  for (const group of serviceGroups) {
    const groupChildren = (childrenOf.get(group.id) || [])
      .map((id) => nodeMap.get(id)!)
      .filter((n) => n?.type === 'layer')
      .sort((a, b) => a.position.y - b.position.y);

    let accShift = 0;
    let allLayersCollapsed = groupChildren.length > 0;

    for (const layer of groupChildren) {
      if (accShift !== 0) {
        yShifts.set(layer.id, accShift);
      }

      if (collapsedIds.has(layer.id)) {
        const originalHeight = ((layer as Record<string, unknown>).style as { height?: number })?.height
          || (layer.measured?.height ?? 100);
        const delta = COLLAPSED_HEIGHT - (originalHeight as number);
        heightDeltas.set(layer.id, delta);
        accShift += delta;
        // Collapsed layer is inherently narrow
        collapsedWidthNodes.add(layer.id);
      } else {
        allLayersCollapsed = false;
        if (depthLevel === 'methods') {
          // Check for collapsed modules within this expanded layer
          // Modules are in a multi-column grid — group by row (same y position)
          const layerModules = (childrenOf.get(layer.id) || [])
            .map((id) => nodeMap.get(id)!)
            .filter((n) => n?.type === 'module')
            .sort((a, b) => a.position.y - b.position.y);

          // Group modules into rows by y position
          const rows: Node[][] = [];
          let currentY = -Infinity;
          for (const mod of layerModules) {
            if (Math.abs(mod.position.y - currentY) > 1) {
              rows.push([]);
              currentY = mod.position.y;
            }
            rows[rows.length - 1].push(mod);
          }

          let modAccShift = 0;
          let allModulesCollapsed = layerModules.length > 0;

          for (const row of rows) {
            // Apply accumulated shift to all modules in this row
            if (modAccShift !== 0) {
              for (const mod of row) {
                yShifts.set(mod.id, modAccShift);
              }
            }

            // Compute row height delta: original row height vs new row height
            let origRowH = 0;
            let newRowH = 0;
            for (const mod of row) {
              const modH = ((mod as Record<string, unknown>).style as { height?: number })?.height
                || (mod.measured?.height ?? 80);
              origRowH = Math.max(origRowH, modH as number);

              if (collapsedIds.has(mod.id)) {
                heightDeltas.set(mod.id, COLLAPSED_HEIGHT - (modH as number));
                newRowH = Math.max(newRowH, COLLAPSED_HEIGHT);
              } else {
                allModulesCollapsed = false;
                newRowH = Math.max(newRowH, modH as number);
              }
            }

            const rowDelta = newRowH - origRowH;
            if (rowDelta !== 0) {
              modAccShift += rowDelta;
            }
          }

          if (modAccShift !== 0) {
            heightDeltas.set(layer.id, (heightDeltas.get(layer.id) || 0) + modAccShift);
            accShift += modAccShift;
          }

          // Module collapse only affects height, not layer/group width.
          // Modules keep their original x position and the layer keeps its width.
        }
      }
    }

    if (accShift !== 0) {
      heightDeltas.set(group.id, accShift);
    }

    // Compute group width from widest layer (using narrowed widths where applicable)
    const GROUP_PAD_X_VAL = 20;
    const groupStyle = (group as Record<string, unknown>).style as { width?: number } | undefined;
    const origGroupWidth = groupStyle?.width ?? 500;
    let maxLayerW = 0;
    for (const layer of groupChildren) {
      const customW = heightDeltas.get(`__layerW__${layer.id}`);
      if (customW) {
        maxLayerW = Math.max(maxLayerW, customW);
      } else if (collapsedWidthNodes.has(layer.id)) {
        maxLayerW = Math.max(maxLayerW, COLLAPSED_WIDTH);
      } else {
        const lStyle = (layer as Record<string, unknown>).style as { width?: number } | undefined;
        maxLayerW = Math.max(maxLayerW, lStyle?.width ?? origGroupWidth - GROUP_PAD_X_VAL * 2);
      }
    }
    const newGroupWidth = maxLayerW + GROUP_PAD_X_VAL * 2;
    if (newGroupWidth < origGroupWidth) {
      collapsedWidthNodes.add(group.id);
      heightDeltas.set(`__groupW__${group.id}`, newGroupWidth);
    }
  }

  // Step 3: Build result nodes
  const GROUP_PAD_X = 20;
  const resultNodes: Node[] = [];
  for (const node of nodes) {
    if (hiddenIds.has(node.id)) continue;

    let modified = node;
    const yShift = yShifts.get(node.id);
    const hDelta = heightDeltas.get(node.id);
    const isCollapsed = collapsedIds.has(node.id);
    const shrinkWidth = collapsedWidthNodes.has(node.id);

    if (yShift || hDelta || isCollapsed || shrinkWidth) {
      let newPos = yShift
        ? { ...node.position, y: node.position.y + yShift }
        : node.position;

      const existingStyle = (node as Record<string, unknown>).style as Record<string, unknown> | undefined;

      let newStyle = existingStyle ? { ...existingStyle } : {};

      if (isCollapsed) {
        newStyle = { ...newStyle, height: COLLAPSED_HEIGHT };
        // Collapsed module containers shrink width (but never grow)
        if (node.type === 'module') {
          const origW = (existingStyle?.width as number) ?? (COLLAPSED_WIDTH - 24);
          newStyle = { ...newStyle, width: Math.min(origW, COLLAPSED_WIDTH - 24) };
        }
      } else if (hDelta && existingStyle?.height) {
        newStyle = { ...newStyle, height: (existingStyle.height as number) + hDelta };
      }

      // Service groups: adjust height
      if (node.type === 'serviceGroup' && hDelta) {
        const origH = existingStyle?.height as number | undefined;
        if (origH) {
          newStyle = { ...newStyle, height: origH + hDelta };
        }
      }

      // Shrink width for collapsed/narrowed containers
      if (shrinkWidth) {
        if (node.type === 'serviceGroup') {
          const computedW = heightDeltas.get(`__groupW__${node.id}`);
          newStyle = { ...newStyle, width: computedW ?? (COLLAPSED_WIDTH + GROUP_PAD_X * 2) };
        } else if (node.type === 'layer') {
          const customW = heightDeltas.get(`__layerW__${node.id}`);
          newStyle = { ...newStyle, width: customW ?? COLLAPSED_WIDTH };
        }
      }

      modified = {
        ...node,
        position: newPos,
        ...((Object.keys(newStyle).length > 0 ? { style: newStyle } : {}) as Record<string, unknown>),
      };
    }

    resultNodes.push(modified);
  }

  // Step 4: Optionally re-layout top-level nodes (only for bulk expand/collapse all)
  if (relayout) {
    const topLevelNodes = resultNodes.filter(
      (n) => n.type === 'serviceGroup' || n.type === 'database',
    );
    if (topLevelNodes.length > 1) {
      const topLevelIds = new Set(topLevelNodes.map((n) => n.id));
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: 'TB', nodesep: 150, ranksep: 200, marginx: 60, marginy: 60 });
      g.setDefaultEdgeLabel(() => ({}));

      for (const node of topLevelNodes) {
        const style = (node as Record<string, unknown>).style as { width?: number; height?: number } | undefined;
        g.setNode(node.id, {
          width: style?.width ?? node.measured?.width ?? 280,
          height: style?.height ?? node.measured?.height ?? 120,
        });
      }

      const seenEdgePairs = new Set<string>();
      for (const edge of edges) {
        const srcGroup = getServiceGroupId(edge.source);
        const tgtGroup = getServiceGroupId(edge.target);
        const src = srcGroup && topLevelIds.has(srcGroup) ? srcGroup : (topLevelIds.has(edge.source) ? edge.source : null);
        const tgt = tgtGroup && topLevelIds.has(tgtGroup) ? tgtGroup : (topLevelIds.has(edge.target) ? edge.target : null);
        if (src && tgt && src !== tgt) {
          const key = `${src}::${tgt}`;
          if (!seenEdgePairs.has(key)) {
            seenEdgePairs.add(key);
            g.setEdge(src, tgt);
          }
        }
      }

      dagre.layout(g);

      for (const node of resultNodes) {
        if (!topLevelIds.has(node.id)) continue;
        const dagreNode = g.node(node.id);
        if (!dagreNode) continue;
        const style = (node as Record<string, unknown>).style as { width?: number; height?: number } | undefined;
        const w = style?.width ?? node.measured?.width ?? 280;
        const h = style?.height ?? node.measured?.height ?? 120;
        node.position = { x: dagreNode.x - w / 2, y: dagreNode.y - h / 2 };
      }
    }
  }

  // Step 5: Edge promotion
  const visibleIds = new Set(resultNodes.map((n) => n.id));

  function findVisibleAncestor(nodeId: string): string | null {
    if (visibleIds.has(nodeId)) return nodeId;
    const node = nodeMap.get(nodeId);
    if (!node) return null;
    const parentId = (node as Record<string, unknown>).parentId as string | undefined;
    if (!parentId) return null;
    return findVisibleAncestor(parentId);
  }

  // Determine same-service-group membership for handle routing
  function getServiceGroupId(nodeId: string): string | null {
    let current = nodeMap.get(nodeId);
    while (current) {
      if (current.type === 'serviceGroup') return current.id;
      const pid = (current as Record<string, unknown>).parentId as string | undefined;
      if (!pid) return null;
      current = nodeMap.get(pid);
    }
    return null;
  }

  const dedupMap = new Map<string, Edge>();
  for (const edge of edges) {
    const src = findVisibleAncestor(edge.source);
    const tgt = findVisibleAncestor(edge.target);
    if (!src || !tgt || src === tgt) continue;

    const pairKey = `${src}::${tgt}`;
    const existing = dedupMap.get(pairKey);
    if (existing) {
      // Sum dependency counts
      const existingCount = (existing.data as Record<string, unknown>)?.dependencyCount as number || 0;
      const newCount = (edge.data as Record<string, unknown>)?.dependencyCount as number || 0;
      dedupMap.set(pairKey, {
        ...existing,
        data: { ...existing.data, dependencyCount: existingCount + newCount },
      });
    } else {
      const srcGroup = getServiceGroupId(src);
      const tgtGroup = getServiceGroupId(tgt);
      const sameGroup = srcGroup && tgtGroup && srcGroup === tgtGroup;

      const promoted = src !== edge.source || tgt !== edge.target;
      const handles = promoted
        ? sameGroup
          ? { sourceHandle: 'right-src', targetHandle: 'right-tgt' }
          : { sourceHandle: 'bottom', targetHandle: 'top' }
        : {};

      dedupMap.set(pairKey, {
        ...edge,
        id: promoted ? `promoted-${pairKey}` : edge.id,
        source: src,
        target: tgt,
        ...(handles as Record<string, unknown>),
      });
    }
  }

  return { nodes: resultNodes, edges: [...dedupMap.values()] };
}
