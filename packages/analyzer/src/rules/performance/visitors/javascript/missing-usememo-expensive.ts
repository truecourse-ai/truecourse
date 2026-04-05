import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { findEnclosingFunctionNode, isInsideHook, findContainingStatement } from './_helpers.js'

const EXPENSIVE_ARRAY_METHODS = new Set(['sort', 'filter', 'reduce', 'flatMap', 'flat'])

export const missingUseMemoExpensiveVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/missing-usememo-expensive',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || !EXPENSIVE_ARRAY_METHODS.has(prop.text)) return null

    // Check if inside a React component function (heuristic: PascalCase function containing JSX return)
    const enclosingFn = findEnclosingFunctionNode(node)
    if (!enclosingFn) return null

    // Get function name
    let funcName = ''
    if (enclosingFn.type === 'function_declaration') {
      const nameNode = enclosingFn.childForFieldName('name')
      if (nameNode) funcName = nameNode.text
    } else if (enclosingFn.parent?.type === 'variable_declarator') {
      const nameNode = enclosingFn.parent.childForFieldName('name')
      if (nameNode) funcName = nameNode.text
    }

    // Must be a PascalCase name (React component)
    if (!funcName || !/^[A-Z]/.test(funcName)) return null

    // Check if we're already inside useMemo or useCallback
    if (isInsideHook(node)) return null

    // Check if the result is already wrapped in useMemo
    const statement = findContainingStatement(node)
    if (statement && statement.text.includes('useMemo')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `Expensive .${prop.text}() in render without useMemo`,
      `.${prop.text}() in a component body recalculates on every render. Wrap in useMemo for stable references.`,
      sourceCode,
      `Wrap the computation in useMemo: const result = useMemo(() => data.${prop.text}(...), [data]);`,
    )
  },
}
