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

    // Skip when chained on Object.entries/keys/values — these produce small arrays
    const obj = fn.childForFieldName('object')
    if (obj?.type === 'call_expression') {
      const objFn = obj.childForFieldName('function')
      if (objFn?.type === 'member_expression') {
        const objObj = objFn.childForFieldName('object')
        const objProp = objFn.childForFieldName('property')
        if (objObj?.text === 'Object' && objProp && ['entries', 'keys', 'values'].includes(objProp.text)) return null
      }
    }

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

    // Skip when the data source is a module-level constant (identifier defined at program level)
    if (obj?.type === 'identifier') {
      let scope = obj.parent
      while (scope && scope.type !== 'program') scope = scope.parent
      if (scope?.type === 'program') {
        // Check if this identifier is defined at the program (module) level
        for (let i = 0; i < scope.namedChildCount; i++) {
          const topLevel = scope.namedChild(i)
          if (topLevel?.type === 'lexical_declaration' || topLevel?.type === 'variable_declaration') {
            const decls = topLevel.namedChildren.filter(c => c.type === 'variable_declarator')
            for (const d of decls) {
              const dName = d.childForFieldName('name')
              if (dName?.text === obj.text) return null
            }
          }
        }
      }
    }

    // Skip when the array literal has <= 5 elements (trivial operation)
    if (obj?.type === 'array') {
      const elements = obj.namedChildren
      if (elements.length <= 5) return null
    }

    // Skip in non-React files (no JSX elements or React imports)
    let root = node.parent
    while (root?.parent) root = root.parent
    if (root) {
      let hasReactIndicator = false
      for (let i = 0; i < root.namedChildCount; i++) {
        const child = root.namedChild(i)
        if (!child) continue
        if (child.type === 'import_statement' && child.text.includes('react')) { hasReactIndicator = true; break }
        if (child.text.includes('jsx') || child.text.includes('JSX')) { hasReactIndicator = true; break }
      }
      if (!hasReactIndicator && !/\.(tsx|jsx)$/.test(filePath)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `Expensive .${prop.text}() in render without useMemo`,
      `.${prop.text}() in a component body recalculates on every render. Wrap in useMemo for stable references.`,
      sourceCode,
      `Wrap the computation in useMemo: const result = useMemo(() => data.${prop.text}(...), [data]);`,
    )
  },
}
