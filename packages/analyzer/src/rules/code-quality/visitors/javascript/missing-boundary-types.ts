import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { FRAMEWORK_ROUTE_EXPORT_NAMES, functionReturnsJsx } from './_helpers.js'

function isDefaultExport(exportNode: import('web-tree-sitter').Node): boolean {
  for (let i = 0; i < exportNode.childCount; i++) {
    if (exportNode.child(i)?.type === 'default') return true
  }
  return false
}

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

    // Skip framework route conventions (Next.js route handlers, Remix route
    // module exports, Next.js metadata helpers). The framework defines the
    // signature so explicit return types are rarely added and not helpful.
    if (FRAMEWORK_ROUTE_EXPORT_NAMES.has(name)) return null

    // Skip default-exported React components (Remix / Next.js page modules):
    // TS infers `JSX.Element` and codebases almost never annotate it. Named
    // JSX-returning exports still get flagged — they're part of a public API
    // surface where stable return types matter.
    if (isDefaultExport(node) && functionReturnsJsx(funcNode)) return null

    return makeViolation(
      this.ruleKey, funcNode, filePath, 'low',
      `Exported function '${name}' missing return type`,
      `Exported function \`${name}\` has no explicit return type — weakens public API type safety.`,
      sourceCode,
      `Add a return type annotation to the exported function.`,
    )
  },
}
