// Two idiomatic shapes that look empty to the AST but aren't:
//
//   1. TS parameter-property constructors. `constructor(private opts: T) {}`
//      and `constructor(readonly db: Db) {}` are not bodyless — the access
//      modifier / `readonly` keyword on the parameter expands to
//      `this.opts = opts` / `this.db = db` at class-init time.
//
//   2. Empty arrow functions passed as call arguments — `useRef(() => {})`,
//      `useEffect(() => {}, [])`, `cb ?? (() => {})`, `.catch(() => {})`.
//      The caller asked for a callable and the empty body is the
//      deliberate placeholder.

interface ServiceOpts {
  readonly forceSimulate: boolean;
}

interface Db {
  readonly query: (_q: string) => Promise<unknown>;
}

export class TaskOperations {
  constructor(private opts: ServiceOpts = { forceSimulate: false }) {}

  describe(): boolean {
    return this.opts.forceSimulate;
  }
}

export class DataLayer {
  constructor(readonly db: Db) {}

  ping(): Promise<unknown> {
    return this.db.query("select 1");
  }
}

declare function useRef<T>(_initial: T): { current: T };
declare function useEffect(_fn: () => void, _deps: ReadonlyArray<unknown>): void;

export function flushScheduler(): { current: () => void } {
  const scheduler = useRef<() => void>(() => {});
  useEffect(() => {}, []);
  return scheduler;
}
