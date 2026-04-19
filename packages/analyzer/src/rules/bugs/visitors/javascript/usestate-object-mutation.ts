import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detect: stateVar.prop = value or stateVar[key] = value
// where stateVar comes from a useState destructuring

function isStateVarMutation(node: SyntaxNode): { stateVar: string; prop: string } | null {
  // assignment_expression where left is member_expression (obj.prop = ...)
  if (node.type !== 'assignment_expression') return null
  const left = node.childForFieldName('left')
  if (!left) return null

  if (left.type === 'member_expression' || left.type === 'subscript_expression') {
    const obj = left.childForFieldName('object')
    if (obj && obj.type === 'identifier') {
      return { stateVar: obj.text, prop: left.text }
    }
  }
  return null
}

function isUseStateDestructure(node: SyntaxNode, stateVar: string): boolean {
  // Look for: const [stateVar, setX] = useState(...)
  if (node.type !== 'variable_declarator') return false
  const nameNode = node.childForFieldName('name')
  if (!nameNode || nameNode.type !== 'array_pattern') return false

  const firstEl = nameNode.namedChildren[0]
  if (!firstEl || firstEl.text !== stateVar) return false

  const value = node.childForFieldName('value')
  if (!value) return false
  // check if the init is a call to useState
  if (value.type === 'call_expression') {
    const fn = value.childForFieldName('function')
    if (fn && fn.text === 'useState') return true
  }
  return false
}

function findUseStateVarsInScope(root: SyntaxNode): Set<string> {
  const stateVars = new Set<string>()
  function walk(n: SyntaxNode) {
    if (n.type === 'variable_declarator') {
      const nameNode = n.childForFieldName('name')
      const value = n.childForFieldName('value')
      if (nameNode?.type === 'array_pattern' && value?.type === 'call_expression') {
        const fn = value.childForFieldName('function')
        if (fn?.text === 'useState') {
          const firstEl = nameNode.namedChildren[0]
          if (firstEl) stateVars.add(firstEl.text)
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(root)
  return stateVars
}

export const usestateObjectMutationVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/usestate-object-mutation',
  languages: JS_LANGUAGES,
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const mutation = isStateVarMutation(node)
    if (!mutation) return null

    // Walk up to find program root to search for useState declarations
    let root: SyntaxNode = node
    while (root.parent) root = root.parent

    const stateVars = findUseStateVarsInScope(root)
    if (!stateVars.has(mutation.stateVar)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Direct mutation of React state object',
      `\`${mutation.prop}\` directly mutates state variable \`${mutation.stateVar}\` — React won't detect this change. Use the setter function with a new object reference instead.`,
      sourceCode,
      `Replace with a state setter call: \`setState(prev => ({ ...prev, key: value }))\`.`,
    )
  },
}
