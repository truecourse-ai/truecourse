/**
 * Real complex-type-alias bug — deeply-nested chain of user-defined
 * generics. Five levels of `WrappedMap<...>` exceeds the bracket-depth
 * threshold and should be broken into named intermediate aliases.
 */

type WrappedMap<K, V> = Map<K, V>;

// VIOLATION: code-quality/deterministic/complex-type-alias
export type DeeplyNestedMap = WrappedMap<
  string,
  WrappedMap<string, WrappedMap<string, WrappedMap<string, WrappedMap<string, number>>>>
>;
