/**
 * Numeric indices into arrays / records can never be `__proto__` /
 * `constructor` / `prototype`. The rule must recognise these patterns:
 *
 *   - forEach / map / reduce callback's index parameter (always number)
 *   - `for (let i = 0; i < n; i++) { obj[i] = ... }` traditional counter
 *
 * Mirrors documenso's
 *   packages/lib/server-only/pdf/render-audit-logs.ts:493
 *   packages/lib/server-only/pdf/render-certificate.ts:660
 * and OpenHands'
 *   frontend/src/components/features/launch/plugin-launch-modal.tsx:40
 */

interface Plugin { readonly id: string }

type ExpandedState = Record<number, boolean>;

// forEach index parameter — guaranteed number by JS spec.
export function buildExpandedState(plugins: ReadonlyArray<Plugin>): ExpandedState {
  const initial: ExpandedState = {};
  plugins.forEach((_, index) => {
    initial[index] = true;
  });
  return initial;
}

// `let idx = N; idx++; arr[idx] = ...` — counter pattern.
export function pushIntoBuckets<T>(items: ReadonlyArray<T>): T[][] {
  const buckets: T[][] = [];
  let currentIndex = 0;
  for (const item of items) {
    if (item === null) {
      currentIndex++;
      buckets[currentIndex] = [item];
    }
  }
  return buckets;
}
