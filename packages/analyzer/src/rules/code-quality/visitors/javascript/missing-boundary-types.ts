import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// React components (PascalCase) and hooks (use*) rely on inference; framework
// route/lifecycle exports follow framework signatures. Neither needs explicit
// return-type annotations — adding them is noise.
const FRAMEWORK_NAMES = new Set([
  'loader', 'action', 'meta', 'links', 'headers', 'default',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  'clientLoader', 'clientAction', 'shouldRevalidate', 'middleware',
  'generateMetadata', 'generateStaticParams', 'generateViewport',
])

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

    // Skip React components, hooks, framework-prescribed exports.
    const isReactComponent = /^[A-Z][A-Za-z0-9]*$/.test(name)
    const isHook = /^use[A-Z0-9]/.test(name)
    const isFrameworkExport = FRAMEWORK_NAMES.has(name)
    if (isReactComponent || isHook || isFrameworkExport) {
      return null
    }

    return makeViolation(
      this.ruleKey, funcNode, filePath, 'low',
      `Exported function '${name}' missing return type`,
      `Exported function \`${name}\` has no explicit return type — weakens public API type safety.`,
      sourceCode,
      `Add a return type annotation to the exported function.`,
    )
  },
}
