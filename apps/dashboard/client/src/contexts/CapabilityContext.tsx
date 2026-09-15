/**
 * App-level edition + capability context.
 *
 * Mounted once at the root of <App>. On boot it calls
 * `GET /api/capabilities` and exposes the result through hooks and a
 * declarative <RequiresCapability> wrapper. While the fetch is in
 * flight (or if it fails) the context returns the safe community
 * default — no enterprise UI ever flashes before its gate has been
 * verified.
 *
 * Tests can bypass the fetch by passing `initial` to AppProvider,
 * e.g. `<AppProvider initial={{ edition: 'enterprise', capabilities: ['sso'] }}>`.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  Capability,
  CapabilitiesResponse,
  Edition,
  ServerMode,
} from '@truecourse/shared';
import { COMMUNITY_CAPABILITIES, DEFAULT_SERVER_MODE } from '@truecourse/shared';
import * as api from '@/lib/api';

export interface CapabilityContextValue {
  edition: Edition;
  /** How the server runs: hosted behind a sign-in, or local on this machine. */
  mode: ServerMode;
  capabilities: ReadonlySet<Capability>;
  /** True while the initial fetch is in flight. */
  isLoading: boolean;
  /** Last error from /api/capabilities, if any. */
  error: Error | null;
}

const DEFAULT_VALUE: CapabilityContextValue = {
  edition: 'community',
  // Hosted until the server says otherwise: the local surfaces are the ones
  // that assume a shared filesystem, so an unanswered probe must not show them.
  mode: DEFAULT_SERVER_MODE,
  capabilities: new Set<Capability>(COMMUNITY_CAPABILITIES),
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
  const [state, setState] = useState<CapabilityContextValue>(() => {
    if (initial) {
      return {
        edition: initial.edition,
        mode: initial.mode ?? DEFAULT_SERVER_MODE,
        capabilities: new Set(initial.capabilities),
        isLoading: false,
        error: null,
      };
    }
    return DEFAULT_VALUE;
  });

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.getCapabilities();
        if (cancelled) return;
        setState({
          edition: resp.edition,
          mode: resp.mode ?? DEFAULT_SERVER_MODE,
          capabilities: new Set(resp.capabilities),
          isLoading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        // Fail closed: keep community defaults so enterprise UI stays
        // hidden if the endpoint is unreachable.
        setState({
          edition: 'community',
          mode: DEFAULT_SERVER_MODE,
          capabilities: new Set(COMMUNITY_CAPABILITIES),
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

/** Current edition (`community` or `enterprise`). */
export function useEdition(): Edition {
  return useContext(CapabilityContext).edition;
}

/**
 * How the server runs. `local` means this machine: there is no sign-in to
 * offer and folders on it can be connected as repositories.
 */
export function useServerMode(): ServerMode {
  return useContext(CapabilityContext).mode;
}

/** True iff `cap` is currently turned on. Defaults to false while loading. */
export function useCapability(cap: Capability): boolean {
  const { capabilities } = useContext(CapabilityContext);
  return capabilities.has(cap);
}

/** Full context value — needed only by code that has to branch on edition or
 *  display a loading skeleton. Prefer `useCapability` / `useEdition`. */
export function useCapabilityContext(): CapabilityContextValue {
  return useContext(CapabilityContext);
}

/**
 * Renders `children` only when `cap` is on. Optional `fallback` renders
 * when the capability is missing (e.g. an upgrade CTA).
 *
 * While the initial fetch is in flight, renders the fallback (or
 * nothing) — never the gated children. This is what prevents an
 * enterprise screen from flashing on first paint.
 */
export function RequiresCapability({
  cap,
  fallback = null,
  children,
}: {
  cap: Capability;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const enabled = useCapability(cap);
  return <>{enabled ? children : fallback}</>;
}
