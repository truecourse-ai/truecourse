
// Snippet: startTransition with void callback containing hydrateRoot call
declare function startTransition(callback: () => void): void;
declare function mountApp(container: Element, ui: unknown): void;
declare const rootElement: Element;
declare const appTree: unknown;

startTransition(() => {
  mountApp(rootElement, appTree);
});



// Snippet: hydrateRoot with document container and JSX element — correct types
declare function hydrateRoot(container: Document | Element, ui: unknown): void;
declare const appUi: unknown;

hydrateRoot(document, appUi);
