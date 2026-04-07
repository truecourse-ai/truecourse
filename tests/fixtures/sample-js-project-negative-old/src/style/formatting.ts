/**
 * Style violations related to formatting and naming.
 */

// VIOLATION: style/deterministic/comment-tag-formatting
// TODO fix this later

// VIOLATION: style/deterministic/js-naming-convention
export function get_user_name(userId: string): string {
  return 'user_' + userId;
}

// VIOLATION: style/deterministic/js-style-preference
export function jsStylePreference() {
  var count = 0;
  return count;
}

// VIOLATION: style/deterministic/ts-declaration-style
interface EmptyConfig {
}

export type ConfigAlias = EmptyConfig;
