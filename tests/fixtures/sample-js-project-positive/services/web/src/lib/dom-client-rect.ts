// Pure DOM helper. The filename intentionally contains "client" — a
// real-world shape that used to put this file in the `external` layer
// purely by name. Nothing about the helper actually touches an external
// service.

export function getElementBox(element: { getBoundingClientRect(): { width: number; height: number } }): {
  width: number;
  height: number;
} {
  return element.getBoundingClientRect();
}
