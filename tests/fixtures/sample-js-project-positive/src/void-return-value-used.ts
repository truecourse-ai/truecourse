/**
 * Positive fixture for bugs/deterministic/void-return-value-used.
 *
 * `Array.prototype.splice`, `.pop`, `.shift`, and `.fill` all return
 * useful values (the removed element, the removed slice, or the
 * mutated array itself). `Map.prototype.set`, `Set.prototype.add`, and
 * router-fluent `.delete` (e.g. Hono) all return chainable receivers.
 * Treating any of these as "void" produces false positives whenever
 * the return value is genuinely consumed.
 */

type FluentRouter = {
  get(path: string, handler: () => string): FluentRouter;
  delete(path: string, handler: () => string): FluentRouter;
};

declare function makeRouter(): FluentRouter;

export function buildRoutes(): FluentRouter {
  // Hono-style fluent route registration — `.delete()` returns the router.
  return makeRouter()
    .get('/account', () => 'ok')
    .delete('/account', () => 'gone');
}

export function reorderItems(source: readonly number[], from: number): number[] {
  const items = [...source];
  // `.splice()` returns the removed elements (an array).
  const [removed] = items.splice(from, 1);
  return [removed, ...items];
}

export function extractEmailDomain(email: string): string | undefined {
  // `.pop()` returns the removed element.
  return email.toLowerCase().split('@').pop();
}

export function popLastItem<T>(source: readonly T[]): T | undefined {
  const items = [...source];
  // `.shift()` returns the removed element.
  return items.shift();
}

export function buildLookupMap(): Map<string, number> {
  // `Map.prototype.set` returns the map itself.
  return new Map<string, number>().set('a', 1).set('b', 2);
}

export function buildLookupSet(): Set<string> {
  // `Set.prototype.add` returns the set itself.
  return new Set<string>().add('x').add('y');
}
