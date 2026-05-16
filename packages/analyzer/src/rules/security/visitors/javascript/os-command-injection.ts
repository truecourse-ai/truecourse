import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const EXEC_METHODS = new Set(['exec', 'execSync'])
const SPAWN_METHODS = new Set(['spawn', 'spawnSync'])

/**
 * Determine whether a bare identifier (e.g. `exec`/`execSync`) is bound to
 * `child_process`'s API in this file. Looks for:
 *   - `import { exec } from 'child_process'` / `import { exec as foo } from 'child_process'`
 *   - `import cp from 'child_process'; cp.exec(...)` (handled at call site, not here)
 *   - `const { exec } = require('child_process')`
 *   - `const cp = require('child_process'); cp.exec(...)` (handled at call site)
 * Returns false when no such binding is found — meaning the identifier likely
 * refers to a local variable that happens to share the name (a common pattern
 * is `const exec = async () => ...` in React effects).
 */
function isChildProcessBoundIdentifier(node: SyntaxNode, name: string): boolean {
  // Walk up to the program root.
  let root: SyntaxNode = node
  while (root.parent) root = root.parent

  function visit(n: SyntaxNode): boolean {
    // ES import: import { exec, execSync as foo } from 'child_process'
    if (n.type === 'import_statement') {
      const source = n.childForFieldName('source')
      const sourceText = source?.text ?? ''
      if (sourceText === "'child_process'" || sourceText === '"child_process"') {
        // Scan the import clause for matching named specifiers.
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (!child) continue
          if (matchesImportClause(child, name)) return true
        }
      }
    }

    // CommonJS: const { exec } = require('child_process')
    // const x = require('child_process'); — produces member-expression call, not relevant here
    if (n.type === 'variable_declarator' || n.type === 'lexical_declaration' || n.type === 'variable_declaration') {
      if (matchesRequireDestructure(n, name)) return true
    }

    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child && visit(child)) return true
    }
    return false
  }

  return visit(root)
}

function matchesImportClause(node: SyntaxNode, name: string): boolean {
  // Recurse to find import_specifier nodes
  if (node.type === 'import_specifier') {
    const nameNode = node.childForFieldName('name')
    const aliasNode = node.childForFieldName('alias')
    const localName = aliasNode?.text ?? nameNode?.text
    if (localName === name) return true
    return false
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && matchesImportClause(child, name)) return true
  }
  return false
}

function matchesRequireDestructure(decl: SyntaxNode, name: string): boolean {
  // Look for: pattern = { ... name ... } = require('child_process')
  // tree-sitter shape: variable_declarator { name: object_pattern, value: call_expression(require, 'child_process') }
  // We accept any descendant matching that shape.
  function check(n: SyntaxNode): boolean {
    if (n.type !== 'variable_declarator') return false
    const valueNode = n.childForFieldName('value')
    const nameNode = n.childForFieldName('name')
    if (!valueNode || !nameNode) return false
    if (valueNode.type !== 'call_expression') return false
    const callee = valueNode.childForFieldName('function')
    if (!callee || callee.type !== 'identifier' || callee.text !== 'require') return false
    const args = valueNode.childForFieldName('arguments')
    if (!args) return false
    const first = args.namedChildren[0]
    if (!first) return false
    const argText = first.text
    if (argText !== "'child_process'" && argText !== '"child_process"') return false
    if (nameNode.type !== 'object_pattern') return false
    // Look for a shorthand_property_identifier_pattern or pair_pattern with our name as the value.
    return objectPatternBindsName(nameNode, name)
  }

  function objectPatternBindsName(pat: SyntaxNode, name: string): boolean {
    for (let i = 0; i < pat.namedChildCount; i++) {
      const c = pat.namedChild(i)
      if (!c) continue
      if (c.type === 'shorthand_property_identifier_pattern' && c.text === name) return true
      if (c.type === 'pair_pattern') {
        // { exec: localName }
        const valueNode = c.childForFieldName('value')
        if (valueNode?.text === name) return true
      }
      // object_assignment_pattern (with default) wraps the binding
      if (c.type === 'object_assignment_pattern') {
        const left = c.childForFieldName('left')
        if (left?.text === name) return true
      }
    }
    return false
  }

  function visit(n: SyntaxNode): boolean {
    if (check(n)) return true
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child && visit(child)) return true
    }
    return false
  }

  return visit(decl)
}

export const osCommandInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/os-command-injection',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop) methodName = prop.text
      if (obj) objectName = obj.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    // child_process.exec() / execSync()
    if (EXEC_METHODS.has(methodName)) {
      // For member expressions (obj.exec()), only flag when the object is plausibly child_process.
      // RegExp.exec() and other .exec() calls are not OS command execution.
      if (fn.type === 'member_expression') {
        const CP_OBJECTS = new Set(['child_process', 'cp', 'childProcess', 'proc'])
        if (!CP_OBJECTS.has(objectName)) return null
      }
      // For bare identifier calls (exec()/execSync()), only flag when the name
      // is bound to child_process via import or require. Local arrow functions
      // named `exec`/`execSync` (a common React pattern) must not trigger.
      if (fn.type === 'identifier' && !isChildProcessBoundIdentifier(node, methodName)) {
        return null
      }
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'OS command injection risk',
        `${methodName}() executes shell commands and is vulnerable to command injection.`,
        sourceCode,
        'Use execFile() or spawn() without shell:true to avoid shell interpretation.',
      )
    }

    // spawn with shell: true
    if (SPAWN_METHODS.has(methodName)) {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'object') {
            for (const prop of arg.namedChildren) {
              if (prop.type === 'pair') {
                const key = prop.childForFieldName('key')
                const value = prop.childForFieldName('value')
                if (key?.text === 'shell' && value?.text === 'true') {
                  return makeViolation(
                    this.ruleKey, node, filePath, 'critical',
                    'OS command injection risk',
                    `${methodName}() with shell:true is vulnerable to command injection.`,
                    sourceCode,
                    'Remove shell:true or use execFile() for safer command execution.',
                  )
                }
              }
            }
          }
        }
      }
    }

    return null
  },
}
