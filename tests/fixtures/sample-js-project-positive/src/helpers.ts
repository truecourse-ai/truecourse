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
