import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

// Minimum string length (without quotes) to be considered "magic"
const MIN_LENGTH = 4
// Minimum occurrences to flag
const MIN_OCCURRENCES = 3

// Parent contexts where a repeated string is rarely an extract-to-constant
// candidate. Mirrors the discriminator set used by `duplicate-string` — these
// positions are framework conventions, type-level constructs, or already-
// indirect references where extracting a constant adds no clarity.
const SKIP_PARENT_TYPES = new Set([
  // Function/method arguments: HTTP methods, MIME types, i18n keys, ts-pattern .with(), etc.
  'arguments',
  // Object property value or key: { method: 'POST' }, { 'Content-Type': '...' }
  'pair',
  // Array literal element: ['active', 'pending', 'archived']
  'array',
  // Inline expression value
  'ternary_expression',
  'binary_expression',
  // case 'foo':
  'switch_case',
  // return / yield / throw of a literal
  'return_statement',
  'yield_expression',
  // enum string member: ADMIN = 'ADMIN'
  'enum_assignment',
  // JSX text / attribute values
  'jsx_attribute',
  'jsx_expression',
  'jsx_element',
  'jsx_self_closing_element',
  'jsx_opening_element',
  // TypeScript type contexts: 'foo' as const, x: 'foo', type T = 'a' | 'b'
  'literal_type',
  'predefined_type',
  'type_annotation',
  'type_alias_declaration',
  'property_signature',
  // Module specifiers
  'import_statement',
  'export_statement',
  'export_specifier',
  'import_specifier',
  // Type assertions
  'as_expression',
  'satisfies_expression',
  // Template literal substitutions
  'template_substitution',
  // Typed map / record lookups: MAP['KEY'], headers['X-Foo']
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

// Top-level constant declarations (lexical_declaration whose parent is `program`
// or `export_statement`) ARE the "extracted constant" pattern. Repeated identical
// strings here are usually distinct named exports that happen to share a value,
// not magic strings begging for extraction. The TP shape is a duplicate string
// INSIDE a function/method body.
function isTopLevelDeclaratorInit(n: SyntaxNode): boolean {
  const decl = n.parent
  if (!decl || decl.type !== 'variable_declarator') return false
  const lex = decl.parent
  if (!lex) return false
  let host = lex.parent
  if (host && host.type === 'export_statement') host = host.parent
  return host?.type === 'program'
}

export const magicStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/magic-string',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node: SyntaxNode, filePath, sourceCode) {
    const counts = new Map<string, SyntaxNode[]>()

    function walk(n: SyntaxNode) {
      if (n.type === 'string') {
        const parent = n.parent
        if (!parent || !SKIP_PARENT_TYPES.has(parent.type)) {
          if (!isTopLevelDeclaratorInit(n)) {
            const text = n.text
            const inner = text.slice(1, -1) // strip quotes
            // Only flag non-trivial strings: alphabetic start, no template
            // interpolation markers, minimum length.
            if (inner.length >= MIN_LENGTH && /^[a-zA-Z]/.test(inner) && !inner.includes('${')) {
              const existing = counts.get(text) ?? []
              existing.push(n)
              counts.set(text, existing)
            }
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (const [text, nodes] of counts) {
      if (nodes.length >= MIN_OCCURRENCES) {
        return makeViolation(
          this.ruleKey, nodes[0], filePath, 'low',
          'Magic string without named constant',
          `String literal \`${text}\` appears ${nodes.length} times — extract to a named constant.`,
          sourceCode,
          `Extract \`${text}\` to a named constant: \`const MY_STRING = ${text};\`.`,
        )
      }
    }
    return null
  },
}
