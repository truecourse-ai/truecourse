// An empty object pattern on the left of a variable declaration binds nothing —
// the developer almost certainly meant to destructure a specific field (or to
// drop the declaration entirely). This dead binding is the real bug the rule
// is meant to catch.

declare function loadConfig(): { host: string; port: number };

export function readHost(): string {
  // VIOLATION: bugs/deterministic/empty-pattern
  const {} = loadConfig();
  return 'localhost';
}
