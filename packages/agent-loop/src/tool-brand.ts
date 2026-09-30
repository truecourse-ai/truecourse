/**
 * The mark only `ToolSpec.bind` puts on a session tool. The package index does
 * not export it, so code outside this package cannot write a `SessionTool`
 * literal: every tool a session runs was bound from a registered spec.
 */
export const BOUND_TOOL: unique symbol = Symbol('truecourse.bound-tool');
