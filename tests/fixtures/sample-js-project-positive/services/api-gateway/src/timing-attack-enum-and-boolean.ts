// Positive: security/deterministic/timing-attack-comparison
//
// `===`/`!==` comparisons where one side is a clear non-secret value —
// an enum constant (`FieldType.SIGNATURE`), a boolean literal, `null`,
// or `undefined` — cannot leak secret information through timing because
// the constant side is publicly known. The rule must not flag these
// just because the other side's identifier happens to contain a word
// like "signature" or "token".

const enum FieldType {
  SIGNATURE = 'SIGNATURE',
  FREE_SIGNATURE = 'FREE_SIGNATURE',
  TEXT = 'TEXT',
}

type SignatureFieldOptions = {
  type: FieldType;
  typedSignatureEnabled: boolean | null;
  signature: string | null;
};

export function isSignatureField(opts: SignatureFieldOptions): boolean {
  return opts.type === FieldType.SIGNATURE || opts.type === FieldType.FREE_SIGNATURE;
}

export function isTypedSignatureAllowed(opts: SignatureFieldOptions): boolean {
  return opts.typedSignatureEnabled !== false;
}

export function isSignatureMissing(opts: SignatureFieldOptions): boolean {
  return opts.signature === null;
}

export function isTokenUnset(token: string | undefined): boolean {
  return token === undefined;
}
