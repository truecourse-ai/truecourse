/**
 * True-bug fixture for bugs/deterministic/global-this-usage.
 *
 * At the top level of a module `this` is `undefined` under strict mode (or the
 * global object otherwise) — capturing it as a value is the portability hazard
 * the rule targets. It is lexically outside any function/class scope.
 */

// VIOLATION: bugs/deterministic/global-this-usage
export const moduleScopeRef = this;
