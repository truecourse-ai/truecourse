/**
 * Positive fixture for bugs/deterministic/restrict-template-expressions.
 *
 * Two FP shapes:
 *
 *   1. `string[]` interpolated in a template literal — Array.prototype
 *      .toString() joins primitive elements with commas, producing
 *      "a,b,c", NOT "[object Object]". The rule's message is wrong for
 *      primitive-element arrays.
 *
 *   2. A union like `string | string[]` (from a header-shaped lookup)
 *      after `??` narrows to non-undefined but still carries the array
 *      branch. Both branches stringify to readable text.
 */

interface IncomingRequest {
  host?: string | string[];
  path?: string;
}

export function describeHeaderNames(headers: Record<string, string>): string {
  return `keys: ${Object.keys(headers)}`;
}

export function buildRequestUrl(req: IncomingRequest): string {
  return `http://${req.host ?? 'localhost'}${req.path ?? '/'}`;
}
