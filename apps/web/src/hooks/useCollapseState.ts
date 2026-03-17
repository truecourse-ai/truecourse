
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Node } from '@xyflow/react';
import type { DepthLevel } from '@/types/graph';
import * as api from '@/lib/api';

export function useCollapseState(
  repoId: string,
  depthLevel: DepthLevel,
  nodes: Node[],
  branch?: string,
  savedCollapsedIds?: string[] | undefined,
) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const bulkActionRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedRef = useRef<string | null>(null);

  // Initialize from savedCollapsedIds returned by the graph API
  useEffect(() => {
    if (depthLevel === 'services' || !repoId) return;
    if (savedCollapsedIds === undefined) return;

    // Deduplicate: don't re-apply the same data
    const fingerprint = `${repoId}:${depthLevel}:${savedCollapsedIds.join(',')}`;
    if (appliedRef.current === fingerprint) return;
    appliedRef.current = fingerprint;

    setCollapsedIds(new Set(savedCollapsedIds));
  }, [repoId, depthLevel, savedCollapsedIds]);

  // Save to DB — debounced for individual toggles, immediate for bulk actions
  const saveToDb = useCallback((ids: Set<string>, immediate = false) => {
    if (depthLevel === 'services' || !repoId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (immediate) {
      api.saveCollapsedIds(repoId, [...ids], branch, depthLevel).catch(() => {});
    } else {
      saveTimerRef.current = setTimeout(() => {
        api.saveCollapsedIds(repoId, [...ids], branch, depthLevel).catch(() => {});
      }, 300);
    }
  }, [repoId, branch, depthLevel]);

  const toggle = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveToDb(next);
      return next;
    });
  }, [saveToDb]);

  const expandAll = useCallback(() => {
    bulkActionRef.current = true;
    const empty = new Set<string>();
    setCollapsedIds(empty);
    saveToDb(empty, true);
  }, [saveToDb]);

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
    saveToDb(all, true);
  }, [nodes, depthLevel, saveToDb]);

  const isBulkAction = useCallback(() => {
    const was = bulkActionRef.current;
    bulkActionRef.current = false;
    return was;
  }, []);

  return { collapsedIds, toggle, expandAll, collapseAll, isBulkAction };
}
