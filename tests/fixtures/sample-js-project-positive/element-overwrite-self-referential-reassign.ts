// Positive: bugs/deterministic/element-overwrite
//
// Re-assigning a property from its own previous value (`x = f(x)`) is never
// a dead store — the overwriting assignment *reads* the value it replaces.
// The canonical "append then de-duplicate" idiom assigns the same target on
// two consecutive lines, but the second line consumes the first, so neither
// write is wasted.

interface Manifest {
  tags: string[];
}

export function mergeTags(manifest: Manifest, incoming: readonly string[]): void {
  manifest.tags = manifest.tags.concat(incoming);
  manifest.tags = Array.from(new Set(manifest.tags));
}
