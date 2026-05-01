/**
 * Helper module for relative namespace import test.
 */

export function capitalize(str: string): string {
  if (str.length === 0) return str;
  const first = str[0] ?? '';
  return first.toUpperCase() + str.slice(1);
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-/gu, '')
    .replace(/-$/gu, '');
}

// `el.innerHTML = ''` clears a node and `el.innerHTML = '<static literal>'`
// inserts a hard-coded HTML fragment - neither of these admits user-controlled
// input, so the disabled-auto-escaping detector must not fire on a static
// or empty RHS.

export function clearList(host: HTMLElement): void {
  host.innerHTML = '';
}

export function renderEmptyState(host: HTMLElement): void {
  host.innerHTML = '<p class="empty">No items yet.</p>';
}

export function renderTitleStatic(host: HTMLElement): void {
  host.innerHTML = `<h1>Dashboard</h1>`;
}

// IIFE wrappers used to scope module-private state. The expression-complexity
// detector counts operators on `expression_statement` nodes by recursing
// into all descendants - including the function bodies inside the IIFE -
// which inflates the count by the operators of every nested function. None
// of the inner function bodies has a complex expression on its own (each
// stays below the 5-op threshold) but together they push the IIFE's
// aggregate count over the limit, firing a false positive on the IIFE.
((): void => {
  function isPositive(n: number): boolean {
    return n > 0;
  }
  function isSmall(n: number): boolean {
    return n < 100;
  }
  function isOdd(n: number): boolean {
    return n % 2 === 1;
  }
  function isEven(n: number): boolean {
    return n % 2 === 0;
  }
  function combine(a: number, b: number): number {
    return a + b;
  }
  const total = combine(1, 2);
  globalThis.dispatchEvent(
    new CustomEvent('iife-ready', { detail: { total, isPositive, isSmall, isOdd, isEven } }),
  );
})();
