/**
 * Positive fixture for bugs/deterministic/unassigned-variable.
 *
 * Two FP shapes that share the same root cause: the visitor only collected
 * assignments at the same scope level as the declaration, skipping all nested
 * functions. But it is idiomatic to declare a variable in the outer scope and
 * assign it from a nested closure — Promise executors and registered event
 * handlers both do this.
 */

interface Resolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export function makeResolvers<T>(): Resolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

interface SelectionStage {
  on(event: string, handler: (pointer: { x: number; y: number } | null) => void): void;
}

export function bindSelectionHandlers(stage: SelectionStage, scale: number): void {
  let x1: number;
  let y1: number;

  stage.on('pointerdown', (pointer) => {
    if (!pointer) return;
    x1 = pointer.x / scale;
    y1 = pointer.y / scale;
  });

  stage.on('pointermove', (pointer) => {
    if (!pointer) return;
    const dx = pointer.x / scale - x1;
    const dy = pointer.y / scale - y1;
    if (dx === 0 && dy === 0) return;
  });
}
