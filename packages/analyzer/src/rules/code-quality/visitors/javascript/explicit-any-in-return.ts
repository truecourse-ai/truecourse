import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const explicitAnyInReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/explicit-any-in-return',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    // Skip visitor-pattern dispatch methods (`visit`, `visitChildren`,
    // `visitTerminal`, `visit<Node>`, `visit_<node>`). Their `any` return is
    // imposed by the visitor interface contract (e.g. antlr's generated
    // ParseTreeVisitor), not a typing oversight the author can narrow.
    if (node.type === 'method_definition') {
      const methodName = node.childForFieldName('name')?.text
      if (methodName && /^visit(?:[A-Z_].*)?$/.test(methodName)) return null
    }

    // Look for return type annotation `: any`
    // In tree-sitter TS, return type is a type_annotation child
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type === 'type_annotation') {
        const typeNode = child.namedChildren[0]
        if (typeNode?.type === 'predefined_type' && typeNode.text === 'any') {
          const nameNode = node.childForFieldName('name')
          return makeViolation(
            this.ruleKey, child, filePath, 'medium',
            `Explicit \`any\` return type`,
            `Function \`${nameNode?.text ?? 'anonymous'}\` has explicit \`: any\` return type. Specify a concrete return type.`,
            sourceCode,
            'Replace `: any` return type with a specific type.',
          )
        }
      }
    }
    return null
  },
}
