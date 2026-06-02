// In-memory Map/Set/WeakMap/WeakSet have a `.delete(key)` method that
// matches the ORM write-method allow-list textually. They are not database
// writes — calls into them should never be flagged as missing-transaction
// candidates.

interface CacheEntry {
  readonly slotIndex: number;
}

export class TimerWheel {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly bySlot = new Map<number, Set<string>>();

  cancel(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    const slot = this.bySlot.get(entry.slotIndex);
    if (slot) slot.delete(key);
    this.entries.delete(key);
    return true;
  }
}

interface Orchestration {
  readonly activeTextPartIndexes: Map<string, number>;
  readonly completedTextPartIds: Set<string>;
}

export function finalizeTextPart(orchestration: Orchestration, id: string): void {
  orchestration.activeTextPartIndexes.delete(id);
  orchestration.completedTextPartIds.delete(id);
}
