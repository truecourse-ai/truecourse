/**
 * Positive fixture for code-quality/deterministic/unused-private-member.
 *
 * Singleton / registry pattern: a `private static` field is read and written
 * via the enclosing class's name (`Registry.cache.set(...)`), not via `this`.
 * The rule must recognise the class-name self-reference as a use, otherwise
 * the canonical singleton/registry implementation always looks "unused".
 */

export class WidgetRegistry {
  private static readonly cache: Map<string, WidgetRegistry> = new Map();

  readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  static getOrCreate(key: string): WidgetRegistry {
    const existing = WidgetRegistry.cache.get(key);
    if (existing) return existing;
    const created = new WidgetRegistry(key);
    WidgetRegistry.cache.set(key, created);
    return created;
  }
}
