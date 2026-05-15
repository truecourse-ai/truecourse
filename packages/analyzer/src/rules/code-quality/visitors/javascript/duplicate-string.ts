import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const duplicateStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-string',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const stringCounts = new Map<string, { count: number; firstNode: SyntaxNode }>()

    // Parent contexts where a repeated string is rarely an extract-to-constant candidate:
    // - arguments: function call arg ('GET', 'application/pdf', i18n keys, ts-pattern .with())
    // - pair: object property value/key ({ method: 'POST' }, { 'Content-Type': '...' })
    // - array: array literal element (['active', 'pending', 'archived'])
    // - ternary/binary: inline expression value (cond ? 'yes' : 'no', x === 'true', a || 'default')
    // - switch_case: case label (case 'foo':)
    // - return/yield/throw: returned literal
    // - enum_assignment: enum string member (ADMIN = 'ADMIN')
    // - jsx_*: JSX attribute / text
    // - literal_type / predefined_type / type_annotation / type_alias_declaration / property_signature:
    //   TypeScript type context
    // - import_statement: module specifier
    // The remaining context — bare expression in declaration / standalone — is where extracting to a
    // constant is genuinely useful (and matches the TP shape: `const a = 'long-string'; const b = ...`).
    const SKIP_PARENT_TYPES = new Set([
      'arguments',
      'pair',
      'array',
      'ternary_expression',
      'binary_expression',
      'switch_case',
      'return_statement',
      'yield_expression',
      'enum_assignment',
      'jsx_attribute',
      'jsx_expression',
      'jsx_element',
      'jsx_self_closing_element',
      'jsx_opening_element',
      'literal_type',
      'predefined_type',
      'type_annotation',
      'type_alias_declaration',
      'property_signature',
      'import_statement',
      'export_statement',
      'export_specifier',
      'import_specifier',
      'as_expression',
      'satisfies_expression',
      'template_substitution',
      // Subscript indexing: typed-record map lookups like MAP['KEY'], headers['X-Foo'] = …
      // are a project style choice for typed constants, not extract-to-constant candidates.
      'subscript_expression',
      // Default values in destructuring patterns and parameter defaults
      'object_assignment_pattern',
      'assignment_pattern',
      'required_parameter',
      'optional_parameter',
      // Assignment expressions (e.g., headers['X-Frame-Options'] = 'DENY')
      'assignment_expression',
      'augmented_assignment_expression',
      // Class field initializers
      'public_field_definition',
    ])

    // Top-level constant declarations (lexical_declaration whose parent is `program` or `export_statement`)
    // are how developers define module-scope constants — already the "extracted constant" pattern.
    // Repeated identical strings here usually indicate distinct constants that happen to share a value
    // (e.g., default encoding repeated across separate exported settings), not magic strings begging for
    // extraction. The TP shape is a duplicate string INSIDE a function body.
    function isTopLevelDeclaratorInit(n: SyntaxNode): boolean {
      // Walk up through variable_declarator → lexical_declaration → (program | export_statement)
      const decl = n.parent // variable_declarator
      if (!decl || decl.type !== 'variable_declarator') return false
      const lex = decl.parent // lexical_declaration / variable_declaration
      if (!lex) return false
      let host = lex.parent
      // Skip through export_statement wrapper
      if (host && host.type === 'export_statement') host = host.parent
      return host?.type === 'program'
    }

    function walk(n: SyntaxNode) {
      if (n.type === 'string') {
        const content = n.text
        if (content.length <= 5) return
        const parent = n.parent
        if (parent && SKIP_PARENT_TYPES.has(parent.type)) return
        if (isTopLevelDeclaratorInit(n)) return

        const existing = stringCounts.get(content)
        if (existing) {
          existing.count++
        } else {
          stringCounts.set(content, { count: 1, firstNode: n })
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (const [content, info] of stringCounts) {
      if (info.count >= 3) {
        return makeViolation(
          this.ruleKey, info.firstNode, filePath, 'low',
          'Duplicate string literal',
          `String ${content} appears ${info.count} times. Extract to a named constant.`,
          sourceCode,
          'Extract the repeated string into a constant variable.',
        )
      }
    }
    return null
  },
}
