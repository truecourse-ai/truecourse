/**
 * Private member violations — kept in separate file for test stability.
 */

// VIOLATION: code-quality/deterministic/unread-private-attribute
class UnreadPrivateViolation {
  private _cache: string = '';
  store(val: string) {
    this._cache = val;
  }
}
export { UnreadPrivateViolation };
