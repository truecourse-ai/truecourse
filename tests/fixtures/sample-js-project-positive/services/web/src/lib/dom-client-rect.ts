// Pure DOM helper. The filename intentionally contains "client" — that's
// the documenso shape (`@documenso/lib/client-only/get-bounding-client-rect`)
// that used to put this file in the `external` layer purely by name.
// Nothing about the helper actually touches an external service.

export function getElementBox(element: { getBoundingClientRect(): { width: number; height: number } }): {
  width: number;
  height: number;
} {
  return element.getBoundingClientRect();
}
