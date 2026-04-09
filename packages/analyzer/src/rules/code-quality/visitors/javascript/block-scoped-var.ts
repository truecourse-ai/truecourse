import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

/**
 * Detects `var` declarations used outside the block where they are textually declared.
 * `var` is function-scoped, but this rule highlights when the usage is logically
 * outside the declaring block (e.g., declared inside an if body, used after the if).
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

    // Find the declaring block node (the block_statement that directly contains the var declaration)
    const declNode = variable.declarationNode
    let declBlockParent = declNode.parent
    while (declBlockParent && declBlockParent.type !== 'statement_block') {
      declBlockParent = declBlockParent.parent
    }
    if (!declBlockParent) return null

    // If the block's parent is a function, this is normal var — no violation
    const blockGrandparent = declBlockParent.parent
    if (!blockGrandparent) return null
    const FUNCTION_TYPES = new Set([
      'function_declaration', 'function', 'arrow_function',
      'method_definition', 'generator_function_declaration', 'generator_function',
    ])
    if (FUNCTION_TYPES.has(blockGrandparent.type)) return null

    // Now check if the reference node is outside the declaring block
    const blockStart = declBlockParent.startIndex
    const blockEnd = declBlockParent.endIndex
    const refStart = node.startIndex

    if (refStart < blockStart || refStart >= blockEnd) {
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
    }
    return null
  },
}
