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
