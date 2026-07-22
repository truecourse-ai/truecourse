// One-shot page-bootstrap events (DOMContentLoaded / load) fire once during the
// page lifecycle and never leak, so pairing them with removeEventListener is
// pointless — the rule must not ask for it.

export function bootstrap(start: () => void): void {
  document.addEventListener('DOMContentLoaded', () => {
    start();
  });
}

export function onReady(handler: () => void): void {
  window.addEventListener('load', handler);
}
