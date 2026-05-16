
// --- empty-function shape: default no-op callback for optional auto-save handler ---
// useAutoSave accepts an optional onAutoSave callback. When none is provided,
// the component still needs to call scheduleSave — the empty async function
// satisfies the type without causing errors.
declare function useAutoSave(
  onSave: (data: unknown) => Promise<void>,
): { scheduleSave: (data: unknown) => void };
declare function useState<T>(init: () => T): [T, (v: T) => void];
declare function useEffect(effect: () => void, deps: unknown[]): void;

export function useFieldAutoSave(
  fieldId: string,
  onAutoSave?: (data: unknown) => Promise<void>,
) {
  const { scheduleSave } = useAutoSave(onAutoSave || (async () => {}));

  const handleSave = (data: unknown) => {
    scheduleSave(data);
  };

  return { handleSave };
}
