/**
 * `typeof X !== 'string'` guards and `tokenList.length === 0` checks are
 * structural — they don't compare the value of the secret, so timing
 * attacks aren't possible. The `timing-attack-comparison` rule must not
 * flag them just because a sensitive word appears in the identifier.
 */

type DecodedToken = { sub?: string; scope?: string };

export function describeSignature(
  signature: unknown,
  signatureTypes: ReadonlyArray<string>,
  decodedToken: DecodedToken,
  scope: string,
): string {
  if (typeof signature !== 'string') {
    return 'not-a-string';
  }
  if (signatureTypes.length === 0) {
    return 'no-types';
  }
  if (typeof decodedToken.sub !== 'string') {
    return 'missing-sub';
  }
  if (decodedToken.scope !== scope) {
    return 'scope-mismatch';
  }
  return 'ok';
}
