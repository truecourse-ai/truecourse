import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingBoundaryTypesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/missing-boundary-types',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    // Check for: export function foo(...) { } without return type
    // Find the function declaration child
    let funcNode = null
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (
        child &&
        (child.type === 'function_declaration' || child.type === 'arrow_function')
      ) {
        funcNode = child
        break
      }
    }

    if (!funcNode) return null

    const returnType = funcNode.childForFieldName('return_type')
    if (returnType) return null

    const nameNode = funcNode.childForFieldName('name')
    const name = nameNode?.text ?? 'function'

    return makeViolation(
      this.ruleKey, funcNode, filePath, 'low',
      `Exported function '${name}' missing return type`,
      `Exported function \`${name}\` has no explicit return type — weakens public API type safety.`,
      sourceCode,
      `Add a return type annotation to the exported function.`,
    )
  },
}
