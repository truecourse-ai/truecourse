import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const reactUnstableKeyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/react-unstable-key',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_element', 'jsx_self_closing_element'],
  visit(node, filePath, sourceCode) {
    // Check if we're inside a .map() callback
    let parent = node.parent
    while (parent) {
      if (parent.type === 'arrow_function' || parent.type === 'function') {
        // Only check the direct return value of the callback, not nested children.
        // For arrow functions: body is the implicit return, or contains return_statement.
        // For regular functions: must be inside a return_statement.
        const callbackBody = parent.childForFieldName('body')
        if (callbackBody) {
          if (callbackBody.type === 'statement_block') {
            // Block body — node must be the argument of a return_statement at the top level
            let isDirectReturn = false
            for (let i = 0; i < callbackBody.namedChildCount; i++) {
              const stmt = callbackBody.namedChild(i)
              if (stmt?.type === 'return_statement') {
                const retVal = stmt.namedChildren[0]
                if (retVal && (retVal.id === node.id || (retVal.type === 'parenthesized_expression' && retVal.namedChildren[0]?.id === node.id))) {
                  isDirectReturn = true
                }
              }
            }
            if (!isDirectReturn) return null
          } else {
            // Implicit return (arrow function body is expression) — node must BE the body
            if (callbackBody.id !== node.id && !(callbackBody.type === 'parenthesized_expression' && callbackBody.namedChildren[0]?.id === node.id)) {
              return null
            }
          }
        }

        const grandParent = parent.parent
        if (grandParent?.type === 'arguments') {
          const callExpr = grandParent.parent
          if (callExpr?.type === 'call_expression') {
            const fn = callExpr.childForFieldName('function')
            if (fn?.type === 'member_expression') {
              const prop = fn.childForFieldName('property')
              if (prop?.text === 'map') {
                // Skip when .map() is called on Array.from() or Array() — these are
                // static, non-reorderable lists (e.g., skeleton loaders)
                const mapObj = fn.childForFieldName('object')
                if (mapObj?.type === 'call_expression') {
                  const mapObjFn = mapObj.childForFieldName('function')
                  if (mapObjFn) {
                    const fnText = mapObjFn.text
                    if (fnText === 'Array.from' || fnText === 'Array') return null
                  }
                }

                // Skip when .map() is called on a static inline array literal
                // e.g., ['a', 'b', 'c'].map(...) or [1, 2, 3].map(...)
                if (mapObj?.type === 'array') return null

                // Skip when .map() is called on a property accessed from an object
                // (e.g., vehicle.imageUrls.map, message.mediaUrls.map, user.permissions.map)
                // These are data display lists that are read-only and not reordered.
                if (mapObj?.type === 'member_expression') return null

                // Skip when .map() is called on a call expression result
                // (e.g., path.split('/').map(), Object.keys(x).map(), getItems().map())
                // These produce derived arrays that are display-only.
                if (mapObj?.type === 'call_expression') return null

                // Skip inside skeleton/loading/placeholder components
                let ancestor = node.parent
                while (ancestor) {
                  if (
                    ancestor.type === 'function_declaration' ||
                    ancestor.type === 'arrow_function' ||
                    ancestor.type === 'function' ||
                    ancestor.type === 'variable_declarator'
                  ) {
                    const funcName = ancestor.type === 'variable_declarator'
                      ? ancestor.childForFieldName('name')?.text
                      : ancestor.childForFieldName('name')?.text
                    if (funcName && /skeleton|loading|placeholder/i.test(funcName)) return null
                  }
                  ancestor = ancestor.parent
                }

                // Skip when file path indicates a landing/marketing/demo page
                // (static lists in these pages are never reordered)
                if (/(?:landing|hero|pricing|demo|marketing|features)/i.test(filePath)) return null

                // Skip when the .map() receiver is a module-level constant:
                // - UPPER_CASE names (e.g., FEATURES, BREADCRUMBS)
                // - Any identifier declared as `const` at module/top level
                if (mapObj?.type === 'identifier') {
                  const name = mapObj.text
                  // ALL_CAPS constants
                  if (/^[A-Z_][A-Z_0-9]*$/.test(name)) return null
                  // Check if the identifier is declared as a const at module level
                  // by walking up to the program root and searching for const declarations
                  let root = node.parent
                  while (root?.parent) root = root.parent
                  if (root) {
                    for (let ci = 0; ci < root.namedChildCount; ci++) {
                      const topStmt = root.namedChild(ci)
                      if (topStmt?.type === 'lexical_declaration' || topStmt?.type === 'export_statement') {
                        const declText = topStmt.text
                        // Match `const name =` at module level
                        if (new RegExp(`\\bconst\\s+${name}\\s*[:=]`).test(declText)) return null
                      }
                    }
                  }

                  // Skip when the variable is computed/derived from another expression
                  // (e.g., `const segments = path.split('/')`, `const items = useMemo(...)`)
                  // by searching the enclosing function body for its declaration.
                  let enclosingFunc = node.parent
                  while (enclosingFunc) {
                    if (
                      enclosingFunc.type === 'function_declaration' ||
                      enclosingFunc.type === 'arrow_function' ||
                      enclosingFunc.type === 'function_expression'
                    ) {
                      break
                    }
                    enclosingFunc = enclosingFunc.parent
                  }
                  if (enclosingFunc) {
                    const funcBody = enclosingFunc.childForFieldName('body')
                    if (funcBody) {
                      // Search for `const name = someCall(...)` or `const name = expr.method(...)`
                      // which indicates the array is derived/computed data, not mutable state
                      const derivedPattern = new RegExp(
                        `\\bconst\\s+${name}\\s*=\\s*(?:[\\w.]+\\(|\\[)`,
                      )
                      if (derivedPattern.test(funcBody.text)) return null
                    }
                  }
                }

                // We're in a .map() — check if JSX element has a key prop
                const openTag = node.type === 'jsx_element'
                  ? node.childForFieldName('open_tag')
                  : node // self-closing

                if (!openTag) return null

                let hasKey = false
                for (let i = 0; i < openTag.childCount; i++) {
                  const child = openTag.child(i)
                  if (!child || child.type !== 'jsx_attribute') continue
                  const attrName = child.namedChildren[0]
                  if (attrName?.text === 'key') {
                    hasKey = true
                    break
                  }
                }

                if (!hasKey) {
                  return makeViolation(
                    this.ruleKey, node, filePath, 'medium',
                    'React list item missing key prop',
                    'JSX element inside `.map()` is missing a `key` prop — React needs stable keys for efficient reconciliation.',
                    sourceCode,
                    'Add a unique `key` prop: `key={item.id}` or `key={index}` (index as last resort).',
                  )
                }

                // Check if key is the array index (unstable)
                for (let i = 0; i < openTag.childCount; i++) {
                  const child = openTag.child(i)
                  if (!child || child.type !== 'jsx_attribute') continue
                  const attrName = child.namedChildren[0]
                  if (attrName?.text !== 'key') continue

                  const attrValue = child.namedChildren[1]
                  if (!attrValue) continue

                  // key={index} where index is the map callback second parameter
                  const mapCallback = parent
                  const mapParams = mapCallback.childForFieldName('parameters') || mapCallback.childForFieldName('parameter')
                  if (mapParams) {
                    // Use tree-sitter's named children to get parameter nodes
                    const paramNodes = mapParams.namedChildren.filter(
                      (c) => c.type === 'identifier' || c.type === 'required_parameter' || c.type === 'object_pattern' || c.type === 'array_pattern',
                    )
                    const indexParamNode = paramNodes[1]
                    const indexParam = indexParamNode?.type === 'identifier'
                      ? indexParamNode.text
                      : indexParamNode?.childForFieldName('pattern')?.text ?? indexParamNode?.childForFieldName('name')?.text

                    // Check if the key value IS the index parameter (exact match, not substring)
                    if (indexParam && attrValue.text === `{${indexParam}}`) {
                      return makeViolation(
                        this.ruleKey, child, filePath, 'medium',
                        'React list key uses array index',
                        `\`key={${indexParam}}\` uses the array index as key — keys should be stable, unique IDs.`,
                        sourceCode,
                        'Use a unique identifier from the data as the key instead of the array index.',
                      )
                    }
                  }
                }
              }
            }
          }
        }
      }
      parent = parent.parent
    }

    return null
  },
}
