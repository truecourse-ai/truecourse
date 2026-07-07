// Positive fixture for bugs/deterministic/global-this-usage.
//
// `this` written inside a classic `function () {}` expression — here a method
// attached to an object after construction — is the call-time receiver, not the
// global object. Modern tree-sitter-javascript types such a `function(){}` as a
// `function_expression`; the visitor's scope-boundary walk must treat that as an
// enclosing scope, or every `this` inside a function expression is misreported
// as a top-level/global reference.

const service = { label: 'idle' };

service.describe = function () {
  return this.label;
};

export { service };
