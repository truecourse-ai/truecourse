/**
 * Style domain JS/TS visitors.
 */

import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

// ---------------------------------------------------------------------------
// import-formatting — Import not at top of file
// ---------------------------------------------------------------------------

export const importFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/import-formatting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    // Check if there's non-import code before this import
    const parent = node.parent
    if (!parent || parent.type !== 'program') return null

    let sawNonImport = false
    for (const child of parent.namedChildren) {
      if (child === node) {
        if (sawNonImport) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Import not at top of file',
            'Import statement found after non-import code. Group all imports at the top.',
            sourceCode,
            'Move this import to the top of the file with the other imports.',
          )
        }
        return null
      }
      // Skip comments and type imports
      if (
        child.type !== 'import_statement' &&
        child.type !== 'comment' &&
        child.type !== 'empty_statement'
      ) {
        sawNonImport = true
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// comment-tag-formatting — Malformed TODO/FIXME
// ---------------------------------------------------------------------------

export const commentTagFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/comment-tag-formatting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text

    // Match TODO or FIXME without colon: "// TODO fix" vs "// TODO: fix"
    const match = text.match(/\b(TODO|FIXME|HACK|XXX)\s+[^:]/)
    if (match) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        `Malformed ${match[1]} comment`,
        `${match[1]} comment should use colon format: '${match[1]}: description'.`,
        sourceCode,
        `Format as: // ${match[1]}: description`,
      )
    }

    // Match TODO/FIXME with no description: "// TODO" or "// TODO:"
    const emptyMatch = text.match(/\b(TODO|FIXME|HACK|XXX):?\s*$/)
    if (emptyMatch) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        `Empty ${emptyMatch[1]} comment`,
        `${emptyMatch[1]} comment has no description.`,
        sourceCode,
        `Add a description: // ${emptyMatch[1]}: what needs to be done`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// js-style-preference — var instead of const/let
// ---------------------------------------------------------------------------

export const jsStylePreferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/js-style-preference',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['variable_declaration'],
  visit(node, filePath, sourceCode) {
    // Flag use of var
    const firstChild = node.children[0]
    if (firstChild?.text === 'var') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Use of var instead of const/let',
        'var has function scope and hoisting issues. Use const for constants or let for variables.',
        sourceCode,
        'Replace var with const (if not reassigned) or let.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// ts-declaration-style — empty interface
// ---------------------------------------------------------------------------

export const tsDeclarationStyleVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/ts-declaration-style',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['interface_declaration'],
  visit(node, filePath, sourceCode) {
    // Flag empty interfaces
    const body = node.childForFieldName('body')
    if (!body) return null

    const members = body.namedChildren.filter((c) => c.type !== 'comment')
    if (members.length === 0) {
      const name = node.childForFieldName('name')
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty interface declaration',
        `Interface ${name?.text ?? ''} has no members. Use a type alias instead: type ${name?.text ?? ''} = Record<string, never>.`,
        sourceCode,
        'Replace the empty interface with a type alias or add members.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// sorting-style — Unsorted named imports
// ---------------------------------------------------------------------------

export const sortingStyleVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/sorting-style',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    // Check named imports: import { z, a, m } from '...'
    const importClause = node.namedChildren.find((c) => c.type === 'import_clause')
    if (!importClause) return null

    const namedImports = importClause.namedChildren.find((c) => c.type === 'named_imports')
    if (!namedImports) return null

    const specifiers = namedImports.namedChildren.filter((c) => c.type === 'import_specifier')
    if (specifiers.length < 2) return null

    const names = specifiers.map((s) => {
      const name = s.childForFieldName('name')
      return name?.text ?? s.text
    })

    const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    if (names.join(',') !== sorted.join(',')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unsorted named imports',
        'Named imports are not sorted alphabetically.',
        sourceCode,
        `Sort imports: { ${sorted.join(', ')} }`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// js-naming-convention — PascalCase for classes, camelCase for functions
// ---------------------------------------------------------------------------

export const jsNamingConventionVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/js-naming-convention',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name) return null

    const funcName = name.text
    // Skip React components (PascalCase is fine for them)
    if (/^[A-Z]/.test(funcName)) {
      // Check if it looks like a React component (returns JSX)
      const body = node.childForFieldName('body')
      if (body && (body.text.includes('jsx') || body.text.includes('<'))) return null

      // Non-component PascalCase function — could be a class-like factory, skip
      return null
    }

    // Functions should be camelCase
    if (funcName.includes('_') && !funcName.startsWith('_')) {
      // snake_case function in JS
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Function uses snake_case naming',
        `Function '${funcName}' uses snake_case. JavaScript convention is camelCase.`,
        sourceCode,
        `Rename to camelCase: ${funcName.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// whitespace-formatting — mixed tabs/spaces
// ---------------------------------------------------------------------------

export const whitespaceFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/whitespace-formatting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const lines = sourceCode.split('\n')
    let hasTabs = false
    let hasSpaces = false

    for (const line of lines) {
      const leadingWhitespace = line.match(/^(\s+)/)?.[1]
      if (leadingWhitespace) {
        if (leadingWhitespace.includes('\t')) hasTabs = true
        if (leadingWhitespace.includes(' ')) hasSpaces = true
      }
    }

    if (hasTabs && hasSpaces) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Mixed tabs and spaces',
        'File uses both tabs and spaces for indentation. Use one consistently.',
        sourceCode,
        'Configure your editor to use spaces (2 or 4) consistently.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// Export all visitors
// ---------------------------------------------------------------------------

export const STYLE_JS_VISITORS: CodeRuleVisitor[] = [
  importFormattingVisitor,
  commentTagFormattingVisitor,
  jsStylePreferenceVisitor,
  tsDeclarationStyleVisitor,
  sortingStyleVisitor,
  jsNamingConventionVisitor,
  whitespaceFormattingVisitor,
]
