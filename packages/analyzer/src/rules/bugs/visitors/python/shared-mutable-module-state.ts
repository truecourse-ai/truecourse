import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: module-level mutable variables that are lists, dicts, sets without being constants

function isModuleLevel(node: SyntaxNode): boolean {
  // In Python tree-sitter, module-level assignments are:
  //   module -> expression_statement -> assignment
  // So parent is expression_statement and grandparent is module
  const parent = node.parent
  if (!parent) return false
  if (parent.type === 'module') return true
  if (parent.type === 'expression_statement' && parent.parent?.type === 'module') return true
  return false
}

function isMutableInit(node: SyntaxNode): boolean {
  return node.type === 'list' || node.type === 'dictionary' || node.type === 'set'
}

function isConstantName(name: string): boolean {
  return name === name.toUpperCase()
}

export const pythonSharedMutableModuleStateVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/shared-mutable-module-state',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    if (!isModuleLevel(node)) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    if (!isMutableInit(right)) return null

    const varName = left.text
    if (isConstantName(varName)) return null // ALL_CAPS are conventions for constants
    if (varName === '__all__') return null // __all__ defines module public API, never mutated at runtime

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Shared mutable state in module scope',
      `\`${varName}\` is a mutable ${right.type} at module level — in server environments this state is shared across all requests, causing race conditions and data leaks.`,
      sourceCode,
      'Move mutable state inside request handlers or use immutable data structures.',
    )
  },
}
