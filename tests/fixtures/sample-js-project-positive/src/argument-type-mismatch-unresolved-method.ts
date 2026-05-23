// Paraphrased FP for bugs/deterministic/argument-type-mismatch.
//
// In the wild, complex third-party generics and barrel-exported helpers
// often emit unrelated TS diagnostics on the same line as a call expression
// (e.g. TS2339 property-not-found, TS2304 cannot-find-name). The old rule
// treated any in-range diagnostic as an argument-type mismatch and fired
// even when the argument types were fine. The fix narrows the gate to
// TS2345/2769/2554/2555 (real argument-type / arity mismatches).
//
// The patterns below are the shapes flagged by the in-wild FPs (variadic
// class-name builder, raw-bytes constructor, validator parse, regex
// constructor). They are well-typed here and must not be reported.

function joinClassNames(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(' ');
}

interface Validator<T> {
  parse(input: unknown): T;
}

interface Recipient {
  readonly id: number;
  readonly displayName: string;
}

const recipientValidator: Validator<Recipient> = {
  parse(input: unknown): Recipient {
    return input as Recipient;
  },
};

export function variadicClassNames(active: boolean, label: string | undefined): string {
  return joinClassNames('base', active && 'is-active', label);
}

export function decodeBytes(raw: Uint8Array): Uint8Array {
  return Uint8Array.from(raw);
}

export function validateRecipient(input: unknown): Recipient {
  return recipientValidator.parse(input);
}

export function compilePattern(prefix: string, suffix: string): RegExp {
  return new RegExp(`(${prefix})(${suffix})$`);
}
