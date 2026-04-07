import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function isInsideEventHandlerOrEffect(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    // Inside useEffect, useCallback, event handler, etc.
    if (current.type === 'call_expression') {
      const fn = current.childForFieldName('function')
      if (fn?.type === 'identifier') {
        const name = fn.text
        if (name === 'useEffect' || name === 'useCallback' || name === 'useMemo') return true
      }
    }
    if (
      current.type === 'arrow_function' ||
      current.type === 'function' ||
      current.type === 'function_declaration'
    ) {
      // Any nested function inside the component is safe — it's an event handler,
      // callback, or helper function, not the component body itself.
      // The only dangerous case is calling a setter directly in the component's
      // own function body, not inside a nested function.
      const parent = current.parent
      // Skip the component function itself (the outermost function)
      // by checking if this function is the component — if its name starts with uppercase
      const nameNode = current.childForFieldName('name')
      if (nameNode && /^[A-Z]/.test(nameNode.text)) {
        // This IS the component function — don't count it as safe, keep walking
        current = current.parent
        continue
      }
      // Any other nested function/arrow = safe (event handler, helper, callback)
      return true
    }
    current = current.parent
  }
  return false
}

function isComponentBody(node: SyntaxNode): boolean {
  // We're in a function that looks like a React component
  // (starts with uppercase, returns JSX)
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (
      current.type === 'function_declaration' ||
      current.type === 'function' ||
      current.type === 'arrow_function'
    ) {
      const name = current.childForFieldName('name')
      if (name && /^[A-Z]/.test(name.text)) return true
    }
    current = current.parent
  }
  return false
}

export const reactHookSetterInBodyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/react-hook-setter-in-body',
  languages: ['tsx', 'javascript'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'call_expression') return null

    const fn = expr.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null

    // Detect: setState(...) or setXxx(...) called directly in component body
    if (!fn.text.startsWith('set') || fn.text.length < 4) return null
    if (!/^set[A-Z]/.test(fn.text)) return null

    // Make sure it's not inside useEffect or event handler
    if (isInsideEventHandlerOrEffect(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      `React hook setter called in component body: ${fn.text}()`,
      `Calling \`${fn.text}()\` directly in the component body causes an infinite render loop.`,
      sourceCode,
      `Move \`${fn.text}()\` into a \`useEffect\`, event handler, or callback.`,
    )
  },
}
