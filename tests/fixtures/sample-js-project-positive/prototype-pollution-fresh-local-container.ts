// Writing an app-controlled dynamic key into a freshly-built local container is
// not a prototype-pollution vector: the object/array is created in this
// function and is not a shared or externally-supplied prototype root. These
// must NOT trip bugs/deterministic/prototype-pollution.
export function buildStateMap(
  ids: readonly string[],
  selectedId: string,
): Record<string, { selected: boolean }> {
  const state: Record<string, { selected: boolean }> = {};
  ids.forEach((id) => {
    state[id] = { selected: false };
  });
  state[selectedId] = { selected: true };
  return state;
}

export function withRenamedField(
  base: Record<string, string>,
  toKey: string,
  value: string,
): Record<string, string> {
  const merged = { ...base };
  merged[toKey] = value;
  return merged;
}
