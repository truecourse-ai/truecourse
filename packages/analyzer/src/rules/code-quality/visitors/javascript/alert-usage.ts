import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const BLOCKED_CALLS = new Set(['alert', 'confirm', 'prompt'])

// See no-alert.ts for the rationale: when a local binding (imported
// or declared) shadows `alert` / `confirm` / `prompt`, the call refers
// to the local — not the browser dialog — and the rule must not fire.
// CLI prompt libraries (`@clack/prompts`, `inquirer`, `prompts`) all
// ship `confirm` / `prompt` named exports that hit this exact shape.
// Keyed by program `id` so the cache invalidates on re-parse.
const localBindingCache = new Map<number, Set<string>>()

function collectLocalBindings(program: SyntaxNode): Set<string> {
  const cached = localBindingCache.get(program.id)
  if (cached) return cached
  const names = new Set<string>()
  for (let i = 0; i < program.namedChildCount; i++) {
    const stmt = program.namedChild(i)
    if (!stmt) continue
    collectFromStatement(stmt, names)
    if (stmt.type === 'export_statement') {
      const decl = stmt.childForFieldName('declaration')
      if (decl) collectFromStatement(decl, names)
    }
  }
  localBindingCache.set(program.id, names)
  return names
}

function collectFromStatement(stmt: SyntaxNode, names: Set<string>): void {
  if (stmt.type === 'import_statement') {
    for (let j = 0; j < stmt.namedChildCount; j++) {
      const clause = stmt.namedChild(j)
      if (!clause || clause.type !== 'import_clause') continue
      for (let k = 0; k < clause.namedChildCount; k++) {
        const part = clause.namedChild(k)
        if (!part) continue
        if (part.type === 'identifier') {
          names.add(part.text)
        } else if (part.type === 'namespace_import') {
          const ns = part.namedChild(part.namedChildCount - 1)
          if (ns?.type === 'identifier') names.add(ns.text)
        } else if (part.type === 'named_imports') {
          for (let m = 0; m < part.namedChildCount; m++) {
            const spec = part.namedChild(m)
            if (!spec || spec.type !== 'import_specifier') continue
            const alias = spec.childForFieldName('alias')
            const name = alias ?? spec.childForFieldName('name')
            if (name?.type === 'identifier') names.add(name.text)
          }
        }
      }
    }
  } else if (stmt.type === 'lexical_declaration' || stmt.type === 'variable_declaration') {
    for (let j = 0; j < stmt.namedChildCount; j++) {
      const decl = stmt.namedChild(j)
      if (decl?.type !== 'variable_declarator') continue
      const name = decl.childForFieldName('name')
      if (name?.type === 'identifier') names.add(name.text)
    }
  } else if (stmt.type === 'function_declaration' || stmt.type === 'class_declaration') {
    const name = stmt.childForFieldName('name')
    if (name?.type === 'identifier') names.add(name.text)
  }
}

function findProgram(node: SyntaxNode): SyntaxNode | null {
  let cur: SyntaxNode | null = node
  while (cur && cur.type !== 'program') cur = cur.parent
  return cur
}

export const jsAlertUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/alert-usage',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null
    if (fn.type !== 'identifier') return null
    const name = fn.text
    if (!BLOCKED_CALLS.has(name)) return null

    const program = findProgram(node)
    if (program) {
      const localBindings = collectLocalBindings(program)
      if (localBindings.has(name)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `${name}() dialog usage`,
      `\`${name}()\` blocks the browser UI thread. Use a custom modal or notification component instead.`,
      sourceCode,
      `Replace \`${name}()\` with a non-blocking UI component.`,
    )
  },
}
