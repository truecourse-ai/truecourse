// Bare `alert`, `confirm`, `prompt` calls with no imported / local
// shadow refer to the browser dialog APIs — UI-thread-blocking calls
// both `no-alert` and the parallel `alert-usage` rule must flag.

export function notify(): void {
  // VIOLATION: code-quality/deterministic/no-alert
  // VIOLATION: code-quality/deterministic/alert-usage
  alert("save failed");
}

export function askForName(): string | null {
  // VIOLATION: code-quality/deterministic/no-alert
  // VIOLATION: code-quality/deterministic/alert-usage
  return prompt("enter your name");
}

export function dangerCheck(): boolean {
  // VIOLATION: code-quality/deterministic/no-alert
  // VIOLATION: code-quality/deterministic/alert-usage
  return confirm("delete the workspace?");
}
