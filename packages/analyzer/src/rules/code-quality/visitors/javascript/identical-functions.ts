import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * Object-key names whose value is a framework-prescribed
 * callback signature. TanStack Query (mutationFn / queryFn /
 * onSuccess / onSettled / onError / onMutate), Zustand /
 * Redux (onLoad), React Hook Form (onSubmit), framer-motion
 * (onAnimationStart / onAnimationComplete), etc.
 */
const FRAMEWORK_CALLBACK_KEYS = new Set([
  'mutationFn', 'queryFn',
  'onSuccess', 'onError', 'onSettled', 'onMutate',
  'onLoad', 'onUnload', 'onReset', 'onSubmit',
  'onValueChange', 'onChange', 'onBlur', 'onFocus', 'onClick',
  'onOpen', 'onClose', 'onToggle',
  'onComplete', 'onAnimationStart', 'onAnimationComplete',
  'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
  'setup', 'teardown',
])

export const identicalFunctionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/identical-functions',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const bodies: Array<{ body: string; fnNode: SyntaxNode }> = []

    function walk(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type)) {
        // Skip functions that are arguments to calls (e.g., Drizzle column defs)
        if (n.parent?.type === 'arguments') { return }
        // Skip arrow callbacks bound to JSX prop attributes —
        // each handler closes over its own surrounding element /
        // form field. The same shape appearing on 5 forms is by
        // design (`onClick={() => save.mutate(x)}`,
        // `onValueChange={(v) => setX(v)}`).
        if (n.type === 'arrow_function' || n.type === 'function_expression') {
          if (n.parent?.type === 'jsx_expression' &&
              n.parent.parent?.type === 'jsx_attribute') return
        }
        // Skip arrow callbacks that are values of framework
        // option-bag callback keys: TanStack Query / Zustand /
        // Apollo / React Hook Form patterns. These are
        // signature-prescribed by the framework — onSuccess /
        // onSettled / onError / mutationFn / queryFn / onValueChange
        // / onSubmit naturally have identical shapes across
        // files because the framework dictates them.
        if (n.type === 'arrow_function' || n.type === 'function_expression') {
          if (n.parent?.type === 'pair') {
            const key = n.parent.childForFieldName('key')
            const keyName = key?.type === 'property_identifier' ? key.text :
              (key?.type === 'string' ? key.text.replace(/^['"]|['"]$/g, '') : '')
            if (FRAMEWORK_CALLBACK_KEYS.has(keyName)) return
          }
        }
        const body = getFunctionBody(n)
        if (body && body.namedChildCount > 0) {
          const normalized = body.text.replace(/\s+/g, ' ').trim()
          bodies.push({ body: normalized, fnNode: n })
        }
        if (body) {
          for (let i = 0; i < body.childCount; i++) {
            const child = body.child(i)
            if (child) walk(child)
          }
        }
        return
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        if (bodies[i].body === bodies[j].body && bodies[i].body.length > 10) {
          const nameA = getFunctionName(bodies[i].fnNode)
          const nameB = getFunctionName(bodies[j].fnNode)
          return makeViolation(
            this.ruleKey, bodies[i].fnNode, filePath, 'medium',
            'Identical function bodies',
            `Functions \`${nameA}\` and \`${nameB}\` have identical bodies. Extract to a shared function.`,
            sourceCode,
            'Extract the shared logic into a helper function and call it from both places.',
          )
        }
      }
    }
    return null
  },
}
