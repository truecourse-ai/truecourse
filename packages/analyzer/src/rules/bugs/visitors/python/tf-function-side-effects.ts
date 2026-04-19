import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects Python side effects inside @tf.function decorated functions.
 * S6928: Side effects (print, list.append, etc.) only execute during tracing, not at runtime.
 */

const SIDE_EFFECT_CALLS = new Set([
  'print', 'input',
])

function hasTfFunctionDecorator(funcNode: import('web-tree-sitter').Node): boolean {
  const parent = funcNode.parent
  if (parent?.type === 'decorated_definition') {
    const decorators = parent.namedChildren.filter((c) => c.type === 'decorator')
    return decorators.some((d) => {
      const text = d.text
      return text.includes('tf.function') || text === '@tf.function'
    })
  }
  return false
}

function findSideEffectCall(node: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null {
  if (node.type === 'call') {
    const func = node.childForFieldName('function')
    if (func) {
      const funcText = func.text
      // Direct print/input calls
      if (SIDE_EFFECT_CALLS.has(funcText)) return node

      // list.append, list.extend, list.insert, etc.
      if (func.type === 'attribute') {
        const attr = func.childForFieldName('attribute')
        if (attr && ['append', 'extend', 'insert', 'remove', 'pop', 'clear', 'update', 'add'].includes(attr.text)) {
          return node
        }
      }
    }
  }

  // Recurse but don't enter nested function definitions
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === 'function_definition' || child.type === 'lambda') continue
    const result = findSideEffectCall(child)
    if (result) return result
  }

  return null
}

export const pythonTfFunctionSideEffectsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/tf-function-side-effects',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    // Find the function definition
    const funcNode = node.namedChildren.find((c) => c.type === 'function_definition')
    if (!funcNode) return null

    // Check for @tf.function decorator
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    const hasTfFunc = decorators.some((d) => {
      const text = d.text
      return text.includes('tf.function')
    })

    if (!hasTfFunc) return null

    const body = funcNode.childForFieldName('body')
    if (!body) return null

    const sideEffect = findSideEffectCall(body)
    if (!sideEffect) return null

    const func = sideEffect.childForFieldName('function')
    const funcName = func?.text ?? 'side_effect'
    const fnName = funcNode.childForFieldName('name')?.text ?? 'function'

    return makeViolation(
      this.ruleKey, sideEffect, filePath, 'high',
      'Side effect inside @tf.function',
      `\`${funcName}()\` inside \`@tf.function\` decorated \`${fnName}\` is a Python side effect — it only executes during graph tracing, not at every call. Use \`tf.print()\` for printing inside TensorFlow functions.`,
      sourceCode,
      `Replace Python \`${funcName}()\` with TensorFlow equivalents (e.g., \`tf.print()\` instead of \`print()\`) or move the side effect outside the \`@tf.function\`.`,
    )
  },
}
