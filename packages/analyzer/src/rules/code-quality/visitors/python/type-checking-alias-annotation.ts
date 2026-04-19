import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects type aliases defined inside `if TYPE_CHECKING:` blocks.
 * Type aliases defined there are only available at type-checking time and will
 * cause NameError at runtime if used in non-quoted annotations.
 *
 * Pattern: if TYPE_CHECKING: block containing `TypeAlias` assignments or
 * simple `Name = Type` patterns.
 */

function isTypeCheckingBlock(node: SyntaxNode): boolean {
  const condition = node.childForFieldName('condition')
  if (!condition) return false
  return condition.text === 'TYPE_CHECKING' || condition.text === 'typing.TYPE_CHECKING'
}

function findTypeAliases(body: SyntaxNode): SyntaxNode[] {
  const aliases: SyntaxNode[] = []
  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i)
    if (!child) continue

    // `Foo: TypeAlias = ...` pattern
    if (child.type === 'type_alias_statement') {
      aliases.push(child)
      continue
    }

    // `Foo = Union[...]` or `Foo = Optional[...]` or `Foo = SomeType` patterns
    if (child.type === 'expression_statement') {
      const expr = child.namedChildren[0]
      if (expr && expr.type === 'assignment') {
        const right = expr.childForFieldName('right')
        if (right) {
          const rightText = right.text
          // Heuristic: if RHS looks like a type (starts with uppercase, or uses Union/Optional/etc.)
          if (/^[A-Z]/.test(rightText) || rightText.includes('Union') || rightText.includes('Optional') ||
              rightText.includes('List') || rightText.includes('Dict') || rightText.includes('Tuple') ||
              rightText.includes('Set') || rightText.includes('Sequence') || rightText.includes('Mapping') ||
              rightText.includes('|')) {
            aliases.push(child)
          }
        }
      }
    }

    // annotated assignment: `Foo: TypeAlias = ...`
    if (child.type === 'assignment') {
      const typeAnn = child.text
      if (typeAnn.includes('TypeAlias')) {
        aliases.push(child)
      }
    }
  }
  return aliases
}

export const pythonTypeCheckingAliasAnnotationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/type-checking-alias-annotation',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    if (!isTypeCheckingBlock(node)) return null

    const body = node.childForFieldName('consequence')
    if (!body) return null

    const aliases = findTypeAliases(body)
    if (aliases.length === 0) return null

    // Flag the first alias found
    const firstAlias = aliases[0]
    return makeViolation(
      this.ruleKey, firstAlias, filePath, 'low',
      'Type alias in TYPE_CHECKING block',
      'Type alias defined inside `if TYPE_CHECKING:` is not available at runtime. Use a string annotation or define it outside the block.',
      sourceCode,
      'Move the type alias outside the `if TYPE_CHECKING:` block, or use string annotations (quotes) where it is referenced.',
    )
  },
}
