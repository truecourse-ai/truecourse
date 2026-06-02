import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// `delete obj[key]` looks like the array-hole bug only when `obj` is
// actually an array. When the receiver is a plain object map — the
// canonical case is the spread-cloned record (`const next = { ...prev };
// delete next[key]`) used to immutably remove a property — `delete` is
// the correct operation. Look for an in-scope declaration of the
// subscripted identifier and skip when its initializer is clearly an
// object: an object literal, a spread / Object.assign / Object.fromEntries
// expression, a destructuring rest pattern, or one of the common object-
// constructing builtins.
function isObjectLikeInit(init: SyntaxNode | null | undefined): boolean {
  if (!init) return false
  if (init.type === 'object' || init.type === 'object_pattern') return true
  if (init.type === 'as_expression' || init.type === 'satisfies_expression' || init.type === 'type_assertion' || init.type === 'parenthesized_expression') {
    return isObjectLikeInit(init.namedChild(0))
  }
  if (init.type === 'call_expression') {
    const callee = init.childForFieldName('function')
    if (!callee) return false
    const text = callee.text
    if (text === 'Object.assign' || text === 'Object.create' || text === 'Object.fromEntries' || text === 'structuredClone') return true
  }
  return false
}

function receiverIsObjectMap(receiver: SyntaxNode): boolean {
  if (receiver.type !== 'identifier') return false
  // Walk enclosing scopes looking for the declaration of this identifier.
  let scope: SyntaxNode | null = receiver.parent
  while (scope) {
    if (
      scope.type === 'statement_block' ||
      scope.type === 'program' ||
      scope.type === 'function_body' ||
      scope.type === 'arrow_function' ||
      scope.type === 'function_declaration' ||
      scope.type === 'function_expression' ||
      scope.type === 'method_definition'
    ) {
      for (let i = 0; i < scope.namedChildCount; i++) {
        const stmt = scope.namedChild(i)
        if (!stmt) continue
        if (stmt.type === 'lexical_declaration' || stmt.type === 'variable_declaration') {
          for (let j = 0; j < stmt.namedChildCount; j++) {
            const decl = stmt.namedChild(j)
            if (decl?.type !== 'variable_declarator') continue
            const declName = decl.childForFieldName('name')
            if (declName?.type === 'identifier' && declName.text === receiver.text) {
              return isObjectLikeInit(decl.childForFieldName('value'))
            }
            if (declName?.type === 'object_pattern') {
              for (let k = 0; k < declName.namedChildCount; k++) {
                const part = declName.namedChild(k)
                if (part?.type === 'rest_pattern') {
                  const id = part.namedChild(0)
                  if (id?.type === 'identifier' && id.text === receiver.text) {
                    // Object-destructuring rest binding is an object map.
                    return true
                  }
                }
              }
            }
          }
        }
      }
    }
    scope = scope.parent
  }
  return false
}

export const arrayDeleteVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/array-delete',
  languages: JS_LANGUAGES,
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.text === 'delete')
    if (!op) return null

    const argument = node.childForFieldName('argument')
    if (!argument || argument.type !== 'subscript_expression') return null

    // Skip the canonical immutable-record pattern: when the subscripted
    // identifier was last assigned an object literal, spread expression,
    // or destructuring-rest binding in scope, `delete` is the correct
    // way to remove a property from a plain object — not an array hole.
    const receiver = argument.childForFieldName('object')
    if (receiver && receiverIsObjectMap(receiver)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'delete on array element',
      `\`${node.text}\` leaves a hole (undefined slot) in the array instead of removing the element. Use \`splice()\` to properly remove elements.`,
      sourceCode,
      'Use `arr.splice(index, 1)` to remove an element without leaving a hole.',
    )
  },
}

