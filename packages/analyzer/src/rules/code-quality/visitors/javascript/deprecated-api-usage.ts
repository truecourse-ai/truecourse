import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { CodeViolation } from '@truecourse/shared'
import type { SyntaxNode } from 'tree-sitter'

/**
 * Detects usage of symbols marked with @deprecated in JSDoc.
 * Scans the file for declarations with a preceding @deprecated JSDoc comment,
 * then flags any identifier reference to those symbols (outside their declaration).
 *
 * Registers on `program` (once per file) to collect all deprecated symbols
 * and their first usage site.
 */
export const deprecatedApiUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deprecated-api-usage',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Step 1: collect names of @deprecated declarations
    const deprecatedNames = new Set<string>()
    const declarationNodes = new Set<SyntaxNode>()
    collectDeprecatedDeclarations(node, deprecatedNames, declarationNodes)

    if (deprecatedNames.size === 0) return null

    // Step 2: find first reference to any deprecated name (not in declaration position)
    return findFirstDeprecatedReference(node, deprecatedNames, declarationNodes, filePath, sourceCode, this.ruleKey)
  },
}

/**
 * Walk the AST collecting all declaration names that have a preceding @deprecated JSDoc comment.
 */
function collectDeprecatedDeclarations(
  root: SyntaxNode,
  names: Set<string>,
  declarationNodes: Set<SyntaxNode>,
): void {
  function walk(node: SyntaxNode): void {
    // Check statements that can have JSDoc comments
    if (
      node.type === 'function_declaration' ||
      node.type === 'generator_function_declaration' ||
      node.type === 'class_declaration' ||
      node.type === 'lexical_declaration' ||
      node.type === 'variable_declaration' ||
      node.type === 'export_statement'
    ) {
      if (hasPrecedingDeprecatedJsDoc(node)) {
        // Extract declared names
        extractDeclaredNames(node).forEach((name) => {
          names.add(name)
          declarationNodes.add(node)
        })
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) walk(child)
    }
  }
  walk(root)
}

function extractDeclaredNames(node: SyntaxNode): string[] {
  const names: string[] = []
  if (node.type === 'function_declaration' || node.type === 'generator_function_declaration' || node.type === 'class_declaration') {
    const nameNode = node.childForFieldName('name')
    if (nameNode) names.push(nameNode.text)
  } else if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const decl = node.namedChild(i)
      if (decl?.type === 'variable_declarator') {
        const nameNode = decl.childForFieldName('name')
        if (nameNode?.type === 'identifier') names.push(nameNode.text)
      }
    }
  } else if (node.type === 'export_statement') {
    // export function foo() {} or export const foo = ...
    const decl = node.namedChildren.find((c) =>
      c.type === 'function_declaration' || c.type === 'lexical_declaration' || c.type === 'class_declaration',
    )
    if (decl) return extractDeclaredNames(decl)
  }
  return names
}

function hasPrecedingDeprecatedJsDoc(stmt: SyntaxNode): boolean {
  const parent = stmt.parent
  if (!parent) return false

  // Find this statement's index among parent's children
  let stmtIdx = -1
  for (let i = 0; i < parent.childCount; i++) {
    if (parent.child(i)?.id === stmt.id) {
      stmtIdx = i
      break
    }
  }
  if (stmtIdx < 0) return false

  // Look at preceding siblings for a block comment containing @deprecated
  for (let i = stmtIdx - 1; i >= 0; i--) {
    const sib = parent.child(i)
    if (!sib) continue
    if (sib.type === 'comment') {
      if (sib.text.includes('@deprecated')) return true
      // Only consider immediately preceding comment
      break
    }
    // Skip anonymous/whitespace nodes
    if (!sib.isNamed) continue
    break
  }
  return false
}

function findFirstDeprecatedReference(
  root: SyntaxNode,
  names: Set<string>,
  declarationNodes: Set<SyntaxNode>,
  filePath: string,
  sourceCode: string,
  ruleKey: string,
): CodeViolation | null {
  function walk(node: SyntaxNode): CodeViolation | null {
    if (node.type === 'identifier' && names.has(node.text)) {
      // Skip if this identifier IS the declaration (inside a declarationNode)
      let ancestor: SyntaxNode | null = node.parent
      let inDecl = false
      while (ancestor) {
        if (declarationNodes.has(ancestor)) {
          inDecl = true
          break
        }
        ancestor = ancestor.parent
      }
      if (!inDecl) {
        // Also skip if this is a property access (a.deprecated — 'deprecated' is a property, not a reference)
        const parent = node.parent
        if (parent?.type === 'member_expression' && parent.childForFieldName('property')?.id === node.id) {
          // Skip — this is property access, not a reference
        } else {
          return makeViolation(
            ruleKey,
            node,
            filePath,
            'medium',
            'Deprecated API usage',
            `\`${node.text}\` is marked @deprecated. Migrate to the recommended replacement.`,
            sourceCode,
            'Read the @deprecated JSDoc comment for the recommended replacement and update your code.',
          )
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) {
        const v = walk(child)
        if (v) return v
      }
    }
    return null
  }
  return walk(root)
}
