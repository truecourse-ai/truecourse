// Negative-fixture TP for mixed-type-exports — deprecated split pattern.

export type ItemId = string;

export function loadItem(id: ItemId): { id: ItemId; name: string } {
  return { id, name: 'sample' };
}

// VIOLATION: code-quality/deterministic/mixed-type-exports
export type { ItemId as ItemIdAlias };
export { loadItem as fetchItem };
