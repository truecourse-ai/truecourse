
// --- empty-function shape: stable no-op subscribe function for useSyncExternalStore ---
// useSyncExternalStore requires a subscribe function but the hydration state
// never changes after mount — the returned unsubscribe is also a no-op.
declare function useSyncExternalStore<T>(
  subscribe: (cb: () => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot: () => T,
): T;

const subscribeToHydration = () => {
  return () => {};
};

export const useIsHydrated = (): boolean => {
  return useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
};
