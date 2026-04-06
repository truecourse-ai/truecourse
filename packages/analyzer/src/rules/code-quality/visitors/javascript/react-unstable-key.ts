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
                    // Get parameter names
                    const paramText = mapParams.text
                    // Common: (item, index) => or (_, i) =>
                    const paramNames = paramText.replace(/[()]/g, '').split(',').map((p) => p.trim().split(':')[0].trim())
                    const indexParam = paramNames[1]

                    if (indexParam && attrValue.text.includes(indexParam)) {
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
