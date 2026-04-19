import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detect: useEffect(fn, [..., {}, [], ...]) — object/array literals in deps array

function hasObjectOrArrayLiteral(depsArray: SyntaxNode): boolean {
  for (const child of depsArray.namedChildren) {
    if (child.type === 'object' || child.type === 'array') return true
  }
  return false
}

export const useeffectObjectDepVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useeffect-object-dep',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.text !== 'useEffect') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const depsArg = args.namedChildren[1]
    if (!depsArg || depsArg.type !== 'array') return null

    if (hasObjectOrArrayLiteral(depsArg)) {
      return makeViolation(
        this.ruleKey, depsArg, filePath, 'high',
        'Object/array literal in useEffect dependency array',
        `An object or array literal in the \`useEffect\` dependency array creates a new reference on every render, causing an infinite loop. Extract it to a variable or use \`useMemo\`.`,
        sourceCode,
        'Move the object/array literal outside the component or wrap it with `useMemo`.',
      )
    }
    return null
  },
}
