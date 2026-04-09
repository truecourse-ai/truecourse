import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects class variables in dataclasses that are missing ClassVar annotation.
 * RUF045: Class-level assignments in @dataclass without ClassVar are treated as instance fields.
 *
 * Pattern: In a @dataclass class, a class-level variable with a type annotation that
 * is NOT wrapped in ClassVar but is clearly intended as a class variable (e.g., it's
 * assigned a non-field value, or has no type annotation but is assigned at class level).
 *
 * We detect the simpler heuristic: type-annotated class-level variables whose annotation
 * does not contain ClassVar, but their assigned value is a literal (suggesting they're
 * intended as constants/class vars).
 */
export const pythonImplicitClassvarInDataclassVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/implicit-classvar-in-dataclass',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Must be a @dataclass
    let isDataclass = false
    const parent = node.parent
    if (parent?.type === 'decorated_definition') {
      const decorators = parent.namedChildren.filter((c) => c.type === 'decorator')
      isDataclass = decorators.some((d) => d.text.includes('dataclass'))
    }

    if (!isDataclass) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const className = node.childForFieldName('name')?.text ?? 'class'

    for (const rawStmt of body.namedChildren) {
      // tree-sitter wraps assignments in expression_statement
      let stmt = rawStmt
      if (stmt.type === 'expression_statement') {
        const inner = stmt.namedChildren[0]
        if (inner) stmt = inner
      }

      // Look for annotated assignments: var: Type = value
      // tree-sitter may represent these as 'assignment' with a 'type' child,
      // or as 'annotated_assignment'
      const isAnnotated = stmt.type === 'annotated_assignment' ||
        (stmt.type === 'assignment' && stmt.namedChildren.some((c) => c.type === 'type'))
      if (!isAnnotated) continue

      // Get annotation text
      let annotText: string | null = null
      if (stmt.type === 'annotated_assignment') {
        annotText = stmt.childForFieldName('annotation')?.text ?? null
      } else {
        // assignment with type child
        const typeNode = stmt.namedChildren.find((c) => c.type === 'type')
        annotText = typeNode?.text ?? null
      }
      if (!annotText) continue

      // Skip if already has ClassVar
      if (annotText.includes('ClassVar')) continue

      // Skip if it's a field() call (dataclass field)
      const value = stmt.childForFieldName('value') ?? stmt.childForFieldName('right')
      if (value?.type === 'call') {
        const func = value.childForFieldName('function')
        if (func?.text === 'field' || func?.text.endsWith('.field')) continue
      }

      // Flag if the variable has an ALL_CAPS name (convention for class constants)
      const targetNode = stmt.childForFieldName('left') ?? stmt.namedChildren[0]
      if (!targetNode) continue

      const varName = targetNode.text

      // ALL_CAPS pattern strongly suggests class variable
      if (/^[A-Z][A-Z0-9_]*$/.test(varName) && varName.length > 1) {
        return makeViolation(
          this.ruleKey, rawStmt, filePath, 'medium',
          'Implicit class variable in dataclass',
          `\`${className}.${varName}\` looks like a class variable but is missing \`ClassVar\` annotation — it will be treated as an instance field by the dataclass machinery.`,
          sourceCode,
          `Annotate with \`ClassVar\`: \`${varName}: ClassVar[${annotText}]\`.`,
        )
      }
    }

    return null
  },
}
