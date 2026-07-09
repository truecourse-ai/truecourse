import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

const FUNCTION_TYPES = new Set([
  'function_declaration', 'function', 'function_expression', 'arrow_function',
  'method_definition', 'generator_function_declaration', 'generator_function',
])

/**
 * The nearest enclosing function body, or the program root for a top-level var.
 * `var` is function-scoped, so this is the boundary within which its
 * declarations and uses must be reconciled.
 */
function enclosingFunctionScope(node: SyntaxNode): SyntaxNode {
  let current: SyntaxNode | null = node.parent
  let root: SyntaxNode = node
  while (current) {
    root = current
    if (FUNCTION_TYPES.has(current.type)) return current
    current = current.parent
  }
  return root
}

/**
 * The block a `var` declaration is scoped to for this rule's purposes: the
 * nearest enclosing `statement_block`. Returns null when the declaration is at
 * function-body / module top level (i.e. the block's parent is a function, or
 * there is no enclosing block) — those are plain function-scoped vars that are
 * visible everywhere in the function and must never be flagged.
 */
function narrowDeclaringBlock(declName: SyntaxNode): SyntaxNode | null {
  let block: SyntaxNode | null = declName.parent
  while (block && block.type !== 'statement_block') block = block.parent
  if (!block) return null
  const parent = block.parent
  if (!parent || FUNCTION_TYPES.has(parent.type)) return null
  return block
}

/**
 * Collect the narrow declaring blocks of every `var NAME` declaration inside a
 * function (without descending into nested functions, which have their own
 * scope). Returns null if ANY declaration is function-scoped — then the var is
 * visible throughout the function and no use is ever "outside its block".
 */
function declaringBlocksFor(functionScope: SyntaxNode, name: string): SyntaxNode[] | null {
  const blocks: SyntaxNode[] = []
  let functionScopedDecl = false

  function walk(n: SyntaxNode) {
    if (functionScopedDecl) return
    // Don't cross into a nested function — it opens a new var scope.
    if (n !== functionScope && FUNCTION_TYPES.has(n.type)) return

    // In the JS/TS grammar `var` parses to `variable_declaration`; `let`/`const`
    // parse to `lexical_declaration`. So the node type alone identifies a `var`.
    if (n.type === 'variable_declarator' && n.parent?.type === 'variable_declaration') {
      const nameNode = n.childForFieldName('name')
      if (nameNode?.type === 'identifier' && nameNode.text === name) {
        const block = narrowDeclaringBlock(nameNode)
        if (!block) { functionScopedDecl = true; return }
        blocks.push(block)
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(functionScope)

  return functionScopedDecl ? null : blocks
}

/**
 * Detects `var` declarations used outside the block where they are textually declared.
 * `var` is function-scoped, but this rule highlights when the usage is logically
 * outside the declaring block (e.g., declared inside an if body, used after the if).
 *
 * A `var` may be declared in several blocks of the same function (redeclaration
 * is legal for function-scoped `var`), so a use is only "outside its block" when
 * it sits outside *every* declaring block — otherwise a use in the second
 * declaration's block is wrongly blamed on the first declaration.
 */
export const blockScopedVarVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/block-scoped-var',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['identifier'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null
    // Only check identifiers that are pure references (not declarations)
    const parent = node.parent
    if (!parent) return null

    // Skip if this is a declaration position
    if (
      (parent.type === 'variable_declarator' && parent.childForFieldName('name')?.id === node.id) ||
      (parent.type === 'function_declaration' && parent.childForFieldName('name')?.id === node.id) ||
      (parent.type === 'class_declaration' && parent.childForFieldName('name')?.id === node.id)
    ) return null

    const variable = dataFlow.resolveReference(node)
    if (!variable) return null
    if (variable.kind !== 'var') return null

    // Gather the declaring blocks of every `var` of this name in the enclosing
    // function. A function-scoped declaration (null) means the var is visible
    // everywhere — never a violation.
    const functionScope = enclosingFunctionScope(variable.declarationNode)
    const blocks = declaringBlocksFor(functionScope, node.text)
    if (blocks === null || blocks.length === 0) return null

    // The reference is fine if it sits inside any declaring block.
    const refStart = node.startIndex
    const insideSomeDeclaringBlock = blocks.some(
      (b) => refStart >= b.startIndex && refStart < b.endIndex,
    )
    if (insideSomeDeclaringBlock) return null

    return makeViolation(
      this.ruleKey,
      node,
      filePath,
      'medium',
      'var used outside its declaring block',
      `Variable \`${node.text}\` is declared with \`var\` inside a block but used outside it. Use \`let\` or \`const\` for block-scoped variables.`,
      sourceCode,
      'Replace `var` with `let` or `const` to limit the variable\'s scope to the block where it is declared.',
    )
  },
}
