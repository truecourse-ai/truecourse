import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const EXEC_METHODS = new Set(['exec', 'execSync'])
const SPAWN_METHODS = new Set(['spawn', 'spawnSync'])

const CHILD_PROCESS_SOURCES = new Set(['child_process', 'node:child_process'])

/**
 * For bare-identifier calls like `exec(...)`, confirm the identifier resolves
 * to a `child_process` binding before flagging — otherwise we false-positive
 * on locally-defined helpers that happen to be named `exec`/`execSync` (a
 * common pattern: `const exec = async () => {...}; void exec();`).
 */
function isImportedFromChildProcess(callNode: SyntaxNode, name: string): boolean {
  let root: SyntaxNode = callNode
  while (root.parent) root = root.parent

  for (const child of root.namedChildren) {
    if (child.type === 'import_statement') {
      const source = child.namedChildren.find((c) => c.type === 'string')
      if (!source) continue
      const raw = source.text.replace(/^['"`]|['"`]$/g, '')
      if (!CHILD_PROCESS_SOURCES.has(raw)) continue
      const importClause = child.namedChildren.find((c) => c.type === 'import_clause')
      if (!importClause) continue
      for (const sub of importClause.namedChildren) {
        if (sub.type === 'named_imports') {
          for (const spec of sub.namedChildren) {
            if (spec.type !== 'import_specifier') continue
            const alias = spec.childForFieldName('alias')
            const local = (alias ?? spec.childForFieldName('name'))?.text
            if (local === name) return true
          }
        }
      }
    } else if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
      // CommonJS: `const { exec } = require('child_process')` /
      // `const { execSync: foo } = require('node:child_process')`.
      const text = child.text
      if (!/require\s*\(\s*['"](?:node:)?child_process['"]\s*\)/.test(text)) continue
      const destructured = new RegExp(
        `[{,]\\s*(?:[A-Za-z_$][\\w$]*\\s*:\\s*)?${name}\\b`,
      )
      if (destructured.test(text)) return true
    }
  }
  return false
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
      } else if (fn.type === 'identifier' && methodName === 'exec') {
        // Bare-identifier `exec(...)`: the name is commonly reused for local
        // async helpers (`const exec = async () => {...}; exec();`), so require
        // evidence it was actually imported from `child_process`. `execSync`
        // is rarely shadowed, so we leave that case as-is.
        if (!isImportedFromChildProcess(node, methodName)) return null
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
