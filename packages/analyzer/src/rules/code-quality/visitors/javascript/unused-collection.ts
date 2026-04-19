import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const unusedCollectionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-collection',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    const collections = new Map<string, SyntaxNode>()

    function isCollectionInit(n: SyntaxNode): boolean {
      if (n.type === 'array') return true
      if (n.type === 'new_expression') {
        const ctor = n.childForFieldName('constructor')
        if (ctor?.text === 'Set' || ctor?.text === 'Map' || ctor?.text === 'Array') return true
      }
      return false
    }

    function collectDecls(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return
      if (n.type === 'variable_declaration' || n.type === 'lexical_declaration') {
        for (const decl of n.namedChildren) {
          if (decl.type === 'variable_declarator') {
            const nameNode = decl.childForFieldName('name')
            const value = decl.childForFieldName('value')
            if (nameNode?.type === 'identifier' && value && isCollectionInit(value)) {
              collections.set(nameNode.text, nameNode)
            }
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectDecls(child)
      }
    }

    // First pass: collect all variable names that appear on the LEFT side of an assignment
    const assignedVars = new Set<string>()
    // Also collect all variable names that appear in a return statement
    const returnedVars = new Set<string>()

    function collectAssignmentsAndReturns(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return
      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier') {
          assignedVars.add(left.text)
        }
      }
      if (n.type === 'return_statement') {
        // Collect all identifiers inside the return value (including shorthand properties like { sampleData })
        function collectReturnIds(r: SyntaxNode) {
          if (r.type === 'identifier' || r.type === 'shorthand_property_identifier' || r.type === 'shorthand_property_identifier_pattern') {
            returnedVars.add(r.text)
          }
          for (let i = 0; i < r.childCount; i++) {
            const c = r.child(i)
            if (c) collectReturnIds(c)
          }
        }
        collectReturnIds(n)
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectAssignmentsAndReturns(child)
      }
    }
    collectAssignmentsAndReturns(bodyNode)

    const reads = new Set<string>()
    function collectReads(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) {
        function markAll(m: SyntaxNode) {
          if (m.type === 'identifier') reads.add(m.text)
          for (let i = 0; i < m.childCount; i++) {
            const c = m.child(i)
            if (c) markAll(c)
          }
        }
        markAll(n)
        return
      }
      if (n.type === 'identifier') {
        const parent = n.parent
        if (parent) {
          if ((parent.type === 'variable_declarator') && parent.childForFieldName('name')?.id === n.id) {
            // declaration — not a read
          } else if ((parent.type === 'assignment_expression') && parent.childForFieldName('left')?.id === n.id) {
            // Assignment target — if this variable is both reassigned AND returned
            // anywhere in the function, it's used (pattern: reassign then return).
            if (assignedVars.has(n.text) && returnedVars.has(n.text)) {
              reads.add(n.text)
            }
          } else {
            reads.add(n.text)
          }
          // Check if the variable appears in a return statement — that counts as usage
          if (parent.type === 'return_statement') {
            reads.add(n.text)
          }
        }
      }
      // Shorthand property identifiers in objects (e.g., `{ sampleData }`) count as reads
      if (n.type === 'shorthand_property_identifier' || n.type === 'shorthand_property_identifier_pattern') {
        reads.add(n.text)
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectReads(child)
      }
    }

    collectDecls(bodyNode)
    collectReads(bodyNode)

    for (const [name, nameNode] of collections) {
      if (!reads.has(name) && !name.startsWith('_')) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'medium',
          'Unused collection',
          `Collection \`${name}\` is created but never read. Remove it or use it.`,
          sourceCode,
          'Remove the unused collection or use its contents somewhere.',
        )
      }
    }
    return null
  },
}
