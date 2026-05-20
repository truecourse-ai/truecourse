/**
 * Positive fixture for code-quality/deterministic/redundant-type-alias.
 *
 * Aliases inside a `declare module 'x' { … }` block (and inside a
 * `declare global { namespace X { … } }` block) deliberately bridge a
 * name from another module into the ambient namespace under a
 * different identifier. They are name-mapping declarations, not
 * redundant wrappers — typical of JSON-typed ORM bridges and similar
 * code-generator conventions.
 */

type TFeatureFlags = { admin: boolean };
type TAuthOptions = { method: 'password' | 'sms' };

declare module '@truecourse-fp-fixture/json-bridge' {
  type FeatureFlags = TFeatureFlags;
  type AuthOptions = TAuthOptions;
}

export type { TFeatureFlags, TAuthOptions };
