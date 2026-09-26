/**
 * How the server runs, read once at the root of <App>.
 *
 * `GET /api/capabilities` is public and answers how this server runs: `hosted`
 * or `local`, and where its MCP is when it has one. The client needs the mode
 * before it has a session, because the sign-in screen itself differs — a local
 * server has nobody to sign in — so it cannot ride the authenticated answer.
 *
 * WHAT THE WORKSPACE MAY USE is not here. That is a fact about the workspace
 * rather than the deployment, so it rides `/api/auth/me` and is read through
 * `useEntitlement` (see `auth/AuthContext`).
 *
 * Tests can bypass the fetch by passing `initial` to AppProvider.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CapabilitiesResponse, McpAvailability, ServerMode } from '@truecourse/shared';
import { DEFAULT_SERVER_MODE } from '@truecourse/shared';
import * as api from '@/lib/api';

export interface CapabilityContextValue {
  /** How the server runs: hosted behind a sign-in, or local on this machine. */
  mode: ServerMode;
  /** Where a developer's MCP client connects, when this server has MCP. */
  mcp: McpAvailability;
  /** True while the initial fetch is in flight. */
  isLoading: boolean;
  /** Last error from /api/capabilities, if any. */
  error: Error | null;
}

const DEFAULT_VALUE: CapabilityContextValue = {
  // Hosted until the server says otherwise: the local surfaces are the ones
  // that assume a shared filesystem, so an unanswered probe must not show them.
  mode: DEFAULT_SERVER_MODE,
  mcp: { available: false },
  isLoading: true,
  error: null,
};

const CapabilityContext = createContext<CapabilityContextValue>(DEFAULT_VALUE);

export interface AppProviderProps {
  children: ReactNode;
  /**
   * Skip the network fetch and use this snapshot directly. Intended
   * for tests and Storybook; production code should never set it.
   */
  initial?: CapabilitiesResponse;
}

export function AppProvider({ children, initial }: AppProviderProps) {
  const [state, setState] = useState<CapabilityContextValue>(() =>
    initial
      ? { mode: initial.mode ?? DEFAULT_SERVER_MODE, mcp: initial.mcp, isLoading: false, error: null }
      : DEFAULT_VALUE,
  );

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.getCapabilities();
        if (cancelled) return;
        setState({ mode: resp.mode ?? DEFAULT_SERVER_MODE, mcp: resp.mcp, isLoading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        // Fail closed: hosted is the answer that assumes nothing about this
        // machine, so an unreachable endpoint shows no local surface.
        setState({
          mode: DEFAULT_SERVER_MODE,
          mcp: { available: false },
          isLoading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const value = useMemo(() => state, [state]);

  return (
    <CapabilityContext.Provider value={value}>
      {children}
    </CapabilityContext.Provider>
  );
}

/**
 * How the server runs. `local` means this machine: there is no sign-in to
 * offer and folders on it can be connected as repositories.
 */
export function useServerMode(): ServerMode {
  return useContext(CapabilityContext).mode;
}

/** Full context value — needed only by code that has to show a loading skeleton. */
export function useCapabilityContext(): CapabilityContextValue {
  return useContext(CapabilityContext);
}
