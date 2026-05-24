// True bug: an empty public function body that callers may legitimately
// rely on to do something. Without a comment explaining the intentional
// no-op, this looks like a forgotten implementation.

export function handleEvent(event: { id: string }): void {
  void event;
}

export class EventHandler {
  // VIOLATION: code-quality/deterministic/no-empty-function
  public handle(event: { id: string }): void {}
}
