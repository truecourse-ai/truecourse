// Positive: code-quality/deterministic/deep-callback-nesting
//
// Config-DSL shapes — arrow functions used as object property values
// inside a nested options bag — read top-to-bottom as data, not as
// chained callbacks. The rule should only count DIRECT callback
// nesting (callback inside a callback inside a callback), not arrow
// functions buried in structural object literals.

type Driver = { name: string };
type Adapter = { kind: string };
type Introspector = { db: unknown };
type QueryCompiler = { run: () => string };
type Dialect = {
  createAdapter: () => Adapter;
  createDriver: () => Driver;
  createIntrospector: (db: unknown) => Introspector;
  createQueryCompiler: () => QueryCompiler;
};

declare function buildDialect(opts: { dialect: Dialect }): { dialect: Dialect };
declare function withExtension<T>(builder: (driver: Driver) => T): T;
declare function defineClient<T>(name: string, factory: () => T): T;

export const client = defineClient('client', () =>
  withExtension((driver) =>
    buildDialect({
      dialect: {
        createAdapter: () => ({ kind: 'postgres' }),
        createDriver: () => driver,
        createIntrospector: (db) => ({ db }),
        createQueryCompiler: () => ({ run: () => 'SELECT 1' }),
      },
    }),
  ),
);
