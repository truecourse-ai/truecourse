// A read-modify-write where the second assignment's RHS reads the value the
// first assignment produced is NOT a dead store — the first write is consumed
// (a common dedup-by-reassign pattern).

interface Manifest {
  packages?: string[]
  conditions?: string[]
}

export function mergeLayer(manifest: Manifest, extra: readonly string[]): Manifest {
  manifest.packages ??= []
  manifest.packages = manifest.packages.concat(extra)
  manifest.packages = Array.from(new Set(manifest.packages))

  manifest.conditions ??= []
  manifest.conditions = manifest.conditions.concat(extra)
  manifest.conditions = Array.from(new Set(manifest.conditions))

  return manifest
}
