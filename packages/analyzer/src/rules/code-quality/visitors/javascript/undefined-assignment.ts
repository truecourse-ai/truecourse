import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const undefinedAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/undefined-assignment',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['assignment_expression', 'variable_declarator'],
  visit(node, filePath, sourceCode) {
    // Skip assignment-expression cases entirely: `obj.prop = undefined` and
    // `x = undefined` are legitimate state mutations / explicit resets. The
    // rule's intent is for redundant declarator initialization, not for
    // post-declaration assignment.
    if (node.type === 'assignment_expression') return null

    if (node.type === 'variable_declarator') {
      const value = node.childForFieldName('value')
      if (value?.text === 'undefined') {
        // Skip when declarator has type annotation including `undefined` or
        // `unknown` — `let x: Foo | undefined = undefined` /
        // `export const X: unknown = undefined` are idiomatic typed-slot
        // initializations.
        const typeAnnot = node.namedChildren.find((c) => c.type === 'type_annotation')
        if (typeAnnot && /\b(?:undefined|unknown)\b/.test(typeAnnot.text)) return null

        const name = node.childForFieldName('name')
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Initialization to undefined',
          `\`${name?.text ?? 'variable'} = undefined\` is redundant — variables are \`undefined\` by default when declared without a value.`,
          sourceCode,
          'Remove the `= undefined` initialization.',
        )
      }
    }

    return null
  },
}
