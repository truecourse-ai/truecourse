/**
 * Positive fixture for security/deterministic/hardcoded-password-function-arg.
 *
 * A kebab-case slug/label passed to a function whose name happens to contain
 * "connect"/"authenticate" is an identifier, not a credential. The rule must
 * not treat lowercase hyphenated labels as hardcoded passwords.
 */

function makeConnectHandler(label: string): () => string {
  return () => label;
}

export function registerWatchers(): () => string {
  return makeConnectHandler("failed-task-watcher");
}
