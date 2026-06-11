import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { findEnclosingFunctionNode, isInsideHook, findContainingStatement } from './_helpers.js'
import { containsJsx } from '../../../_shared/javascript-helpers.js'

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

    const obj = fn.childForFieldName('object')

    // .filter() is O(n) and cheap on its own — only worth memoizing when it
    // appears in a multi-stage chain (e.g. .filter().map().filter()) where
    // the work compounds. Plain .filter(Boolean) at the tail of any chain is
    // the standard null-removal idiom and never warrants useMemo.
    if (prop.text === 'filter') {
      const args = node.childForFieldName('arguments')
      if (args && args.namedChildCount === 1) {
        const arg = args.namedChild(0)
        if (arg?.type === 'identifier' && arg.text === 'Boolean') return null
      }
      if (obj?.type !== 'call_expression') return null
    }

    // Skip when chained on Object.entries/keys/values — these produce small arrays
    if (obj?.type === 'call_expression') {
      const objFn = obj.childForFieldName('function')
      if (objFn?.type === 'member_expression') {
        const objObj = objFn.childForFieldName('object')
        const objProp = objFn.childForFieldName('property')
        if (objObj?.text === 'Object' && objProp && ['entries', 'keys', 'values'].includes(objProp.text)) return null
      }
    }

    // Skip trivial .reduce() callbacks — a single binary expression on the
    // two parameters (e.g. `(sum, v) => sum + v`) is O(1) per item and does
    // not benefit from memoization. The expensive reduce shape (object
    // spread accumulator) is handled by spread-in-reduce.
    if (prop.text === 'reduce') {
      const args = node.childForFieldName('arguments')
      const callback = args?.namedChild(0)
      if (callback?.type === 'arrow_function' || callback?.type === 'function_expression' || callback?.type === 'function') {
        const body = callback.childForFieldName('body')
        let inspect = body
        // Unwrap a parenthesized arrow body like `(acc, x) => (acc + x)`.
        if (inspect?.type === 'parenthesized_expression') {
          inspect = inspect.namedChildren[0] ?? inspect
        }
        if (inspect?.type === 'binary_expression') return null
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

    // Skip in non-React files (no JSX elements or React imports).
    // Use a real AST JSX check + check import sources, not text grep.
    let root = node.parent
    while (root?.parent) root = root.parent
    if (root) {
      let hasReactIndicator = false
      // Check imports for any module starting with 'react' (react, react-dom, react-router, etc.)
      for (let i = 0; i < root.namedChildCount; i++) {
        const child = root.namedChild(i)
        if (!child) continue
        if (child.type === 'import_statement') {
          const sourceNode = child.childForFieldName('source')
          const importedFrom = sourceNode?.text.replace(/^['"]|['"]$/g, '') ?? ''
          if (importedFrom === 'react' || importedFrom.startsWith('react/') || importedFrom.startsWith('react-')) {
            hasReactIndicator = true
            break
          }
        }
      }
      // Or check the file extension (.tsx/.jsx → React-flavoured)
      if (!hasReactIndicator && !/\.(tsx|jsx)$/.test(filePath)) {
        // As a final check, walk the AST to see if there's any actual JSX
        if (!containsJsx(root)) return null
      }
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
