// True bug: assigning `javascript:` URL to an anchor's href — equivalent
// to `eval` and a known XSS vector.

type AnchorStub = { href: string };

export function attachOpener(anchor: AnchorStub): void {
  // VIOLATION: code-quality/deterministic/no-script-url
  anchor.href = 'javascript:openDialog()';
}
