// Single utility sets a data attribute — one usage, not a meaningful duplicate
declare const document: {
  createElement(tag: string): HTMLElement & { setAttribute(k: string, v: string): void; dataset: Record<string, string> };
};

function createValidatableField(
  type: string,
  validationRule: string,
): HTMLElement & { setAttribute(k: string, v: string): void; dataset: Record<string, string> } {
  const el = document.createElement('input');
  el.setAttribute('type', type);
  el.setAttribute('data-validate', validationRule);
  return el;
}
