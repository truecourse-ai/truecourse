/**
 * Positive fixture for code-quality/deterministic/redundant-template-expression.
 *
 * A tagged template like `tag\`${value}\`` is NOT a redundant string template.
 * The tag function receives the template parts and substitutions and returns
 * whatever it wants (e.g. a structured descriptor object), so the wrapper
 * cannot be replaced with the bare expression. The visitor must not fire
 * when the template_string sits directly under a tagged call_expression.
 */

interface LocalizedDescriptor {
  parts: readonly string[];
  values: readonly unknown[];
}

function describe(strings: TemplateStringsArray, ...values: readonly unknown[]): LocalizedDescriptor {
  return { parts: Array.from(strings), values };
}

export function describeAgent(agent: string): LocalizedDescriptor {
  return describe`${agent}`;
}

export function describeSelection(label: string): LocalizedDescriptor {
  return describe`${label}`;
}
