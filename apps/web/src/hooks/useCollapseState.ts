'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Node } from '@xyflow/react';
import type { DepthLevel } from '@/types/graph';

function storageKey(repoId: string, depthLevel: DepthLevel) {
  return `truecourse:collapsed:${repoId}:${depthLevel}`;
}

export function useCollapseState(
  repoId: string,
  depthLevel: DepthLevel,
  nodes: Node[],
) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const initializedRef = useRef<string | null>(null);
  const bulkActionRef = useRef(false);

  // Initialize collapsed state: all layers (and modules in methods mode) collapsed
  useEffect(() => {
    const key = `${repoId}:${depthLevel}`;
    if (initializedRef.current === key) return;
    initializedRef.current = key;

    // Try loading from localStorage
    const saved = localStorage.getItem(storageKey(repoId, depthLevel));
    if (saved) {
      try {
        const ids = JSON.parse(saved) as string[];
        setCollapsedIds(new Set(ids));
        return;
      } catch {
        // fall through to defaults
      }
    }

    // Default: collapse all layers and modules
    const defaultCollapsed = new Set<string>();
    for (const node of nodes) {
      if (depthLevel === 'modules' && node.type === 'layer' && (node.data as Record<string, unknown>).isContainer) {
        defaultCollapsed.add(node.id);
      }
      if (depthLevel === 'methods') {
        if (node.type === 'layer' && (node.data as Record<string, unknown>).isContainer) {
          defaultCollapsed.add(node.id);
        }
        if (node.type === 'module' && (node.data as Record<string, unknown>).isContainer) {
          defaultCollapsed.add(node.id);
        }
      }
    }
    setCollapsedIds(defaultCollapsed);
  }, [repoId, depthLevel, nodes]);

  // Persist to localStorage
  useEffect(() => {
    if (depthLevel === 'services') return;
    localStorage.setItem(storageKey(repoId, depthLevel), JSON.stringify([...collapsedIds]));
  }, [collapsedIds, repoId, depthLevel]);

  const toggle = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    bulkActionRef.current = true;
    setCollapsedIds(new Set());
  }, []);

  const collapseAll = useCallback(() => {
    bulkActionRef.current = true;
    const all = new Set<string>();
    for (const node of nodes) {
      if (node.type === 'layer' && (node.data as Record<string, unknown>).isContainer) {
        all.add(node.id);
      }
      if (depthLevel === 'methods' && node.type === 'module' && (node.data as Record<string, unknown>).isContainer) {
        all.add(node.id);
      }
    }
    setCollapsedIds(all);
  }, [nodes, depthLevel]);

  const isBulkAction = useCallback(() => {
    const was = bulkActionRef.current;
    bulkActionRef.current = false;
    return was;
  }, []);

  return { collapsedIds, toggle, expandAll, collapseAll, isBulkAction };
}
