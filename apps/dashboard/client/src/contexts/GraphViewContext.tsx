/**
 * Graph-view state: the architecture graph's depth (services / modules
 * / methods), its scope (which service / module is drilled into), the
 * transient "focus this node" request, and the currently highlighted
 * service. Depth + scope are mirrored to the URL (?mode/?scopeService/
 * ?scopeModule) so deep links and Back/Forward stay coherent.
 *
 * Lifted out of RepoPage so the graph canvas, the home panel's
 * "locate" actions, and any future view can drive the graph through
 * `useGraphView()` instead of prop-drilling a dozen setters.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { DepthLevel } from '@/types/graph';

// URL term (functions) ↔ internal term (methods).
const urlToDepth: Record<string, DepthLevel> = {
  services: 'services',
  modules: 'modules',
  functions: 'methods',
};
const depthToUrl: Record<DepthLevel, string> = {
  services: 'services',
  modules: 'modules',
  methods: 'functions',
};

export interface LocateHints {
  serviceId?: string | null;
  moduleId?: string | null;
}

export interface FocusRequest {
  nodeId: string;
  key: number;
}

export interface GraphViewContextValue {
  /** Node id highlighted from a click (visual only — not scope). */
  selectedService: string | null;
  setSelectedService: (id: string | null) => void;
  depthLevel: DepthLevel;
  setDepthLevel: (level: DepthLevel) => void;
  scopedServiceId: string | null;
  setScopedServiceId: (id: string | null) => void;
  scopedModuleId: string | null;
  setScopedModuleId: (id: string | null) => void;
  focusRequest: FocusRequest | null;
  setFocusRequest: (req: FocusRequest | null) => void;
  /**
   * Jump the graph to a node at a given depth + scope in a single URL
   * navigation, then request focus on it. Hints override the inferred
   * scope; omitted hints preserve the current scope.
   */
  locateNode: (
    nodeId: string,
    requiredDepth?: string,
    hints?: LocateHints,
  ) => void;
}

const GraphViewContext = createContext<GraphViewContextValue | null>(null);

export function GraphViewProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [depthLevel, setDepthLevelState] = useState<DepthLevel>(
    () => urlToDepth[searchParams?.get('mode') || ''] || 'services',
  );
  const [scopedServiceId, setScopedServiceIdState] = useState<string | null>(
    () => searchParams?.get('scopeService') || null,
  );
  const [scopedModuleId, setScopedModuleIdState] = useState<string | null>(
    () => searchParams?.get('scopeModule') || null,
  );
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const setScopedServiceId = useCallback(
    (id: string | null) => {
      setScopedServiceIdState(id);
      const url = new URL(window.location.href);
      if (id) url.searchParams.set('scopeService', id);
      else url.searchParams.delete('scopeService');
      navigate(url.pathname + url.search);
    },
    [navigate],
  );

  const setScopedModuleId = useCallback(
    (id: string | null) => {
      setScopedModuleIdState(id);
      const url = new URL(window.location.href);
      if (id) url.searchParams.set('scopeModule', id);
      else url.searchParams.delete('scopeModule');
      navigate(url.pathname + url.search);
    },
    [navigate],
  );

  const setDepthLevel = useCallback(
    (level: DepthLevel) => {
      setDepthLevelState(level);
      const url = new URL(window.location.href);
      if (level === 'services') {
        url.searchParams.delete('mode');
        // Services depth doesn't consume scope params — strip them from
        // the URL but keep them in memory so returning to modules/methods
        // restores the user's last picks.
        url.searchParams.delete('scopeService');
        url.searchParams.delete('scopeModule');
      } else if (level === 'modules') {
        url.searchParams.set('mode', 'modules');
        // Modules depth uses `scopeService` but not `scopeModule` — keep
        // the module id in memory for when the user returns to methods.
        url.searchParams.delete('scopeModule');
        if (scopedServiceId) url.searchParams.set('scopeService', scopedServiceId);
      } else {
        url.searchParams.set('mode', depthToUrl[level]);
        // Methods depth: restore both scope params from memory if present.
        if (scopedServiceId) url.searchParams.set('scopeService', scopedServiceId);
        if (scopedModuleId) url.searchParams.set('scopeModule', scopedModuleId);
      }
      navigate(url.pathname + url.search);
    },
    [navigate, scopedServiceId, scopedModuleId],
  );

  const locateNode = useCallback(
    (nodeId: string, requiredDepth?: string, hints?: LocateHints) => {
      const targetDepth = (requiredDepth ?? depthLevel) as DepthLevel;

      // Derive next scope from hints + target depth. Hints win when
      // provided; otherwise preserve existing scope (e.g. a repeat
      // Locate on the same service).
      let nextServiceId: string | null = scopedServiceId;
      let nextModuleId: string | null = scopedModuleId;
      if (targetDepth === 'services') {
        nextServiceId = null;
        nextModuleId = null;
      } else if (targetDepth === 'modules') {
        if (hints?.serviceId !== undefined) nextServiceId = hints.serviceId ?? null;
        nextModuleId = null;
      } else {
        if (hints?.serviceId !== undefined) nextServiceId = hints.serviceId ?? null;
        if (hints?.moduleId !== undefined) nextModuleId = hints.moduleId ?? null;
      }

      setDepthLevelState(targetDepth);
      setScopedServiceIdState(nextServiceId);
      setScopedModuleIdState(nextModuleId);

      const url = new URL(window.location.href);
      if (targetDepth === 'services') url.searchParams.delete('mode');
      else url.searchParams.set('mode', depthToUrl[targetDepth]);
      if (nextServiceId) url.searchParams.set('scopeService', nextServiceId);
      else url.searchParams.delete('scopeService');
      if (nextModuleId) url.searchParams.set('scopeModule', nextModuleId);
      else url.searchParams.delete('scopeModule');
      navigate(url.pathname + url.search);

      // A depth change remounts the canvas; wait a beat before focusing
      // so the target node exists. Same-depth locate can focus now.
      if (requiredDepth && requiredDepth !== depthLevel) {
        setTimeout(() => setFocusRequest({ nodeId, key: Date.now() }), 500);
      } else {
        setFocusRequest({ nodeId, key: Date.now() });
      }
    },
    [depthLevel, scopedServiceId, scopedModuleId, navigate],
  );

  // Mirror graph URL params into state on Back/Forward + deep links.
  useEffect(() => {
    setDepthLevelState(urlToDepth[searchParams?.get('mode') ?? ''] ?? 'services');
    setScopedServiceIdState(searchParams?.get('scopeService') ?? null);
    setScopedModuleIdState(searchParams?.get('scopeModule') ?? null);
  }, [searchParams]);

  const value = useMemo<GraphViewContextValue>(
    () => ({
      selectedService,
      setSelectedService,
      depthLevel,
      setDepthLevel,
      scopedServiceId,
      setScopedServiceId,
      scopedModuleId,
      setScopedModuleId,
      focusRequest,
      setFocusRequest,
      locateNode,
    }),
    [
      selectedService,
      depthLevel,
      setDepthLevel,
      scopedServiceId,
      setScopedServiceId,
      scopedModuleId,
      setScopedModuleId,
      focusRequest,
      locateNode,
    ],
  );

  return (
    <GraphViewContext.Provider value={value}>
      {children}
    </GraphViewContext.Provider>
  );
}

export function useGraphView(): GraphViewContextValue {
  const ctx = useContext(GraphViewContext);
  if (!ctx) {
    throw new Error('useGraphView must be used inside <GraphViewProvider>');
  }
  return ctx;
}
