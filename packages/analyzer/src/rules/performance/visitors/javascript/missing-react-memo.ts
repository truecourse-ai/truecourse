import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingReactMemoVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/missing-react-memo',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    // Look for: export default function ComponentName or export const Component =
    // that returns JSX but is not wrapped in React.memo
    const declaration = node.namedChildren[0]
    if (!declaration) return null

    let funcNode: SyntaxNode | null = null
    let funcName = ''

    if (declaration.type === 'function_declaration') {
      funcNode = declaration
      const nameNode = declaration.childForFieldName('name')
      if (nameNode) funcName = nameNode.text
    } else if (declaration.type === 'lexical_declaration') {
      const declarator = declaration.namedChildren.find((c) => c.type === 'variable_declarator')
      if (declarator) {
        const nameNode = declarator.childForFieldName('name')
        const valueNode = declarator.childForFieldName('value')
        if (nameNode) funcName = nameNode.text
        if (valueNode?.type === 'arrow_function' || valueNode?.type === 'function') {
          funcNode = valueNode
        }
      }
    }

    if (!funcNode || !funcName || !/^[A-Z]/.test(funcName)) return null

    // Skip all-uppercase names — these are HTTP method handlers (GET, POST, PUT, DELETE, PATCH),
    // not React components. React components use PascalCase.
    if (funcName === funcName.toUpperCase()) return null

    // Skip Next.js/framework route files — page, layout, loading, error, route handlers
    const routePatterns = /\/(page|layout|loading|error|not-found|template|route)\.(tsx|jsx|ts|js)$/
    if (routePatterns.test(filePath)) return null

    // Check if component returns JSX
    const bodyText = funcNode.text
    if (!bodyText.includes('<') || !bodyText.includes('>')) return null

    // Skip components with no props — memo provides no benefit
    const params = funcNode.childForFieldName('parameters') || funcNode.childForFieldName('parameter')
    if (!params || params.namedChildCount === 0) return null
    // Skip destructured empty params like ({}) or ({}: Props)
    const firstParam = params.namedChildren[0]
    if (firstParam?.type === 'object_pattern' && firstParam.namedChildCount === 0) return null

    // Strip comments before checking for memo references
    const codeOnly = sourceCode.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

    // Check if already wrapped in memo
    if (codeOnly.includes(`memo(${funcName}`) || codeOnly.includes(`React.memo(${funcName}`)) return null

    // Only flag if file seems to not use memo at all
    if (codeOnly.includes('React.memo') || codeOnly.includes('memo(')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Component ${funcName} without React.memo`,
      `${funcName} is exported but not wrapped in React.memo(). If it receives stable props, wrapping it can prevent unnecessary re-renders.`,
      sourceCode,
      `Export with memo: export default React.memo(${funcName});`,
    )
  },
}
