import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames, getCSharpRootNode, walkCSharp } from '../../../_shared/csharp-helpers.js'

/**
 * A switch over an enum that handles some members via `EnumName.Member`
 * labels but misses others, with no default/discard arm. A switch statement
 * silently does nothing for the missing members; a switch expression throws
 * SwitchExpressionException at runtime.
 *
 * PARTIAL: only enums declared in the SAME FILE are checked (cross-file
 * needs the symbol index). [Flags] enums and switches using non-constant
 * patterns or `when` filters are skipped.
 */
function fileEnums(root: SyntaxNode): Map<string, Set<string>> {
  const enums = new Map<string, Set<string>>()
  walkCSharp(root, (n) => {
    if (n.type !== 'enum_declaration') return
    if (getCSharpAttributeNames(n).some((a) => a === 'Flags' || a === 'FlagsAttribute')) return
    const name = n.childForFieldName('name')?.text
    const body = n.childForFieldName('body')
    if (!name || !body) return
    const members = new Set<string>()
    for (const m of body.namedChildren) {
      if (m?.type !== 'enum_member_declaration') continue
      const memberName = m.childForFieldName('name')?.text
      if (memberName) members.add(memberName)
    }
    enums.set(name, members)
  })
  return enums
}

/** `Status.Active` → { enumName: 'Status', member: 'Active' }, else null. */
function enumLabel(pattern: SyntaxNode): { enumName: string; member: string } | null {
  if (pattern.type !== 'constant_pattern') return null
  const access = pattern.namedChildren[0]
  if (access?.type !== 'member_access_expression') return null
  const expr = access.childForFieldName('expression')
  const name = access.childForFieldName('name')
  if (expr?.type !== 'identifier' || name?.type !== 'identifier') return null
  return { enumName: expr.text, member: name.text }
}

const PATTERN_TYPES = new Set([
  'constant_pattern', 'declaration_pattern', 'discard', 'var_pattern',
  'relational_pattern', 'negated_pattern', 'binary_pattern', 'type_pattern',
  'recursive_pattern', 'parenthesized_pattern', 'list_pattern',
])

function analyzeLabels(labels: SyntaxNode[], hasDefault: boolean, root: SyntaxNode): { enumName: string; missing: string[] } | null {
  if (hasDefault) return null
  let enumName: string | null = null
  const covered = new Set<string>()
  for (const label of labels) {
    const parsed = enumLabel(label)
    if (!parsed) return null // non-enum-constant pattern → out of scope
    if (enumName === null) enumName = parsed.enumName
    else if (enumName !== parsed.enumName) return null
    covered.add(parsed.member)
  }
  if (!enumName || covered.size === 0) return null

  const declared = fileEnums(root).get(enumName)
  if (!declared) return null // enum not declared in this file → partial scope
  const missing = [...declared].filter((m) => !covered.has(m))
  return missing.length > 0 ? { enumName, missing } : null
}

export const csharpSwitchExhaustivenessVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/switch-exhaustiveness',
  languages: ['csharp'],
  nodeTypes: ['switch_statement', 'switch_expression'],
  visit(node, filePath, sourceCode) {
    const root = getCSharpRootNode(node)
    let result: { enumName: string; missing: string[] } | null = null

    if (node.type === 'switch_statement') {
      const body = node.childForFieldName('body')
      if (!body) return null
      const labels: SyntaxNode[] = []
      let hasDefault = false
      for (const section of body.namedChildren) {
        if (section?.type !== 'switch_section') continue
        if (section.children.some((c) => c?.type === 'default')) hasDefault = true
        if (section.namedChildren.some((c) => c?.type === 'when_clause')) return null
        for (const child of section.namedChildren) {
          if (child && PATTERN_TYPES.has(child.type)) labels.push(child)
        }
      }
      result = analyzeLabels(labels, hasDefault, root)
    } else {
      const labels: SyntaxNode[] = []
      let hasDefault = false
      for (const arm of node.namedChildren) {
        if (arm?.type !== 'switch_expression_arm') continue
        if (arm.namedChildren.some((c) => c?.type === 'when_clause')) return null
        const pattern = arm.namedChildren[0]
        if (!pattern) continue
        if (pattern.type === 'discard') hasDefault = true
        else labels.push(pattern)
      }
      result = analyzeLabels(labels, hasDefault, root)
    }

    if (!result) return null
    const isExpression = node.type === 'switch_expression'
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Non-exhaustive enum switch',
      `This switch over \`${result.enumName}\` does not handle ${result.missing.map((m) => `\`${result!.enumName}.${m}\``).join(', ')} and has no default arm — ${isExpression ? 'it throws SwitchExpressionException for those values' : 'those values silently fall through'}.`,
      sourceCode,
      `Handle the missing member${result.missing.length !== 1 ? 's' : ''} or add a default ${isExpression ? 'discard arm (`_ =>`)' : 'case'} that fails loudly.`,
    )
  },
}
