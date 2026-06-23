/**
 * Positive fixture for code-quality/deterministic/restricted-types.
 *
 * A union type alias that enumerates built-in / primitive types is a
 * type-set used purely for structural matching in a conditional type
 * (`T extends Primitiveish ? ...`). The `Function` member is a matcher,
 * not a usable annotation, so the rule must not flag it. (This is the
 * `Builtin`/`DeepPartial` idiom emitted by protobuf-to-TS code generators.)
 */

type Primitiveish = Date | Function | Uint8Array | string;

export type DeepReadonly<T> = T extends Primitiveish
  ? T
  : T extends Array<infer U>
    ? Array<DeepReadonly<U>>
    : { readonly [K in keyof T]: DeepReadonly<T[K]> };
