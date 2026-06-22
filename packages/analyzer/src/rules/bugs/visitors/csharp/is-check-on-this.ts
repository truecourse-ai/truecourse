import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * The type name a pattern unambiguously checks for, or null. A bare
 * `this is Sub` parses as a `constant_pattern` that the grammar can't
 * distinguish from a constant comparison, so only the capture form
 * `this is Sub s` (a `declaration_pattern`, always a type test) is reported —
 * this keeps the rule free of false positives.
 */
function patternTypeName(pattern: SyntaxNode): string | null {
  if (pattern.type === 'declaration_pattern') {
    return pattern.childForFieldName('type')?.text ?? null
  }
  return null
}

/**
 * `this is SomeDerivedType d` — a base class testing its own runtime type
 * against a subclass couples the base to its descendants and signals a broken
 * inheritance design (the behavior that varies by subtype belongs in a virtual
 * member). Constant patterns (`this is null`, `this is SomeConst`) are not type
 * tests and are left alone.
 */
export const csharpIsCheckOnThisVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/is-check-on-this',
  languages: ['csharp'],
  nodeTypes: ['is_pattern_expression'],
  visit(node, filePath, sourceCode) {
    const expr = node.childForFieldName('expression')
    if (expr?.type !== 'this_expression' && expr?.text !== 'this') return null

    const pattern = node.childForFieldName('pattern')
    if (!pattern) return null
    const typeName = patternTypeName(pattern)
    if (!typeName) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Type check on `this`',
      `\`this is ${typeName}\` couples this base type to a specific subclass — inheriting types should override a virtual member rather than be detected by an \`is\` check on \`this\`.`,
      sourceCode,
      'Replace the type check with a virtual/abstract member that each subclass overrides.',
    )
  },
}
