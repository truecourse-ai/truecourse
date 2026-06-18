/**
 * Loads the enterprise client module once the edition is known, and
 * exposes its capability-filtered route + nav contributions to the OSS
 * shell (the route registry in App and the header nav).
 *
 * In community mode nothing is loaded — `routes`/`navItems` stay empty,
 * so the OSS UI is untouched. The actual import is gated + dynamic (see
 * loadEeModule), so the ee chunk is never fetched for community users.
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
  EeClientModule,
  EeNavItem,
  EeRoute,
} from '@truecourse/shared';
import { useCapabilityContext } from '@/contexts/CapabilityContext';
import { loadEeModule } from '@/ee/loadEeModule';

interface EeModuleContextValue {
  routes: EeRoute[];
  navItems: EeNavItem[];
  /** Enterprise home override for "/", if the module provides one. */
  homeComponent?: EeClientModule['homeComponent'];
  /** Persistent console chrome (live-state provider + sidebar widgets). */
  shell?: EeClientModule['shell'];
  loaded: boolean;
}

const EeModuleContext = createContext<EeModuleContextValue>({
  routes: [],
  navItems: [],
  loaded: false,
});

export function EeModuleProvider({ children }: { children: ReactNode }) {
  const { edition, isLoading, capabilities } = useCapabilityContext();
  const [mod, setMod] = useState<EeClientModule | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (edition !== 'enterprise') {
      setMod(null);
      return;
    }
    let cancelled = false;
    void loadEeModule().then((m) => {
      if (!cancelled) setMod(m);
    });
    return () => {
      cancelled = true;
    };
  }, [edition, isLoading]);

  const value = useMemo<EeModuleContextValue>(() => {
    const isOn = (c?: Capability) => !c || capabilities.has(c);
    return {
      routes: (mod?.routes ?? []).filter((r) => isOn(r.requiredCapability)),
      navItems: (mod?.navItems ?? []).filter((n) => isOn(n.requiredCapability)),
      homeComponent: mod?.homeComponent,
      shell: mod?.shell,
      loaded: mod !== null,
    };
  }, [mod, capabilities]);

  return (
    <EeModuleContext.Provider value={value}>
      {children}
    </EeModuleContext.Provider>
  );
}

export function useEeModule(): EeModuleContextValue {
  return useContext(EeModuleContext);
}
