// Positive: code-quality/deterministic/deep-callback-nesting
//
// Nested array-iteration callbacks (.map / .filter / .flatMap) are
// synchronous functional data transforms, read top-to-bottom — not the
// asynchronous pyramid-of-callbacks the rule is meant to catch. Even when a
// `.map` chain is nested several levels deep to walk a tree-shaped value,
// it should not count toward callback-nesting depth.

interface Region {
  readonly zones: Zone[];
}
interface Zone {
  readonly racks: Rack[];
}
interface Rack {
  readonly slots: Slot[];
}
interface Slot {
  readonly id: string;
}

export function collectSlotIds(regions: readonly Region[]): string[][][] {
  return regions.map((region) =>
    region.zones.map((zone) =>
      zone.racks.map((rack) =>
        rack.slots.map((slot) => slot.id),
      ),
    ),
  );
}
