import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideLoop } from './_helpers.js'
import { containsIdentifierExact } from '../../../_shared/javascript-helpers.js'

export const jsonParseInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/json-parse-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'JSON') return null
    if (prop?.text !== 'parse' && prop?.text !== 'stringify') return null

    if (!isInsideLoop(node)) return null

    // Skip when parsing different data each iteration — only flag when the same
    // static value is parsed repeatedly. Dynamic arguments: variables that are
    // loop iterators, array element access, or function call results.
    //
    // Identifier matching uses containsIdentifierExact (real AST) instead of
    // text.includes(varName), which leaked across substrings (varName "i"
    // matched "iterator", "valid", etc.).
    const args = node.childForFieldName('arguments')
    if (args) {
      const firstArg = args.namedChildren[0]
      if (firstArg) {
        // Function call result: JSON.parse(getData()) — different each iteration
        if (firstArg.type === 'call_expression') return null
        // Array/object element access: JSON.parse(items[i]) — different each iteration
        if (firstArg.type === 'subscript_expression') return null
        // Template literal: JSON.parse(`${x}`) — likely dynamic
        if (firstArg.type === 'template_string') return null
        // Variable that is a loop parameter (for-of/for-in variable, or for-loop index)
        if (firstArg.type === 'identifier') {
          const varName = firstArg.text
          let current = node.parent
          while (current) {
            if (current.type === 'for_in_statement' || current.type === 'for_of_statement') {
              const left = current.childForFieldName('left')
              if (left && containsIdentifierExact(left, varName)) return null
            }
            if (current.type === 'for_statement') {
              const init = current.childForFieldName('initializer')
              if (init && containsIdentifierExact(init, varName)) return null
            }
            // .forEach / .map callback parameter
            if (current.type === 'arrow_function' || current.type === 'function_expression' || current.type === 'function') {
              const params = current.childForFieldName('parameters')
              if (params && containsIdentifierExact(params, varName)) {
                const callParent = current.parent?.parent
                if (callParent?.type === 'call_expression') return null
              }
            }
            current = current.parent
          }
        }
        // Member expression like item.data — likely different per iteration
        if (firstArg.type === 'member_expression') {
          const innerObj = firstArg.childForFieldName('object')
          if (innerObj?.type === 'identifier') {
            // Check if the object is a loop variable
            let current = node.parent
            while (current) {
              if (current.type === 'for_in_statement' || current.type === 'for_of_statement') {
                const left = current.childForFieldName('left')
                if (left && containsIdentifierExact(left, innerObj.text)) return null
              }
              if (current.type === 'arrow_function' || current.type === 'function_expression' || current.type === 'function') {
                const params = current.childForFieldName('parameters')
                if (params && containsIdentifierExact(params, innerObj.text)) {
                  const callParent = current.parent?.parent
                  if (callParent?.type === 'call_expression') return null
                }
              }
              current = current.parent
            }
          }
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `JSON.${prop.text}() inside loop`,
      `JSON.${prop.text}() is expensive and calling it inside a loop degrades performance. Move it outside the loop if possible.`,
      sourceCode,
      `Cache the result of JSON.${prop.text}() outside the loop.`,
    )
  },
}
