import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const EXEC_METHODS = new Set(['exec', 'execSync'])
const SPAWN_METHODS = new Set(['spawn', 'spawnSync'])

// Walk the program looking for a local user-defined function binding that
// shadows `name`. A binding qualifies only if its value is a function or
// arrow expression — i.e. the user wrote `function name() {...}`,
// `const name = () => {...}`, or `const name = function() {...}`.
//
// Re-bindings from `child_process` (e.g. `const { exec } = require('child_process')`
// or `const exec = cp.exec`) deliberately do NOT qualify — the underlying
// callee is still the dangerous one and the rule must continue to fire.
function hasLocalUserDefinedBinding(callNode: SyntaxNode, name: string): boolean {
  let root: SyntaxNode | null = callNode
  while (root && root.parent) root = root.parent
  if (!root) return false

  function isFunctionExpr(node: SyntaxNode): boolean {
    return node.type === 'arrow_function'
        || node.type === 'function_expression'
        || node.type === 'function'
  }

  function bindsName(node: SyntaxNode): boolean {
    // function declaration: `function name(...) {...}`
    if (node.type === 'function_declaration') {
      return node.childForFieldName('name')?.text === name
    }
    // variable declarator: `const name = <function-expr-or-arrow>`
    if (node.type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name')
      if (nameNode?.type === 'identifier' && nameNode.text === name) {
        const value = node.childForFieldName('value')
        if (value && isFunctionExpr(value)) return true
      }
    }
    return false
  }

  function walk(n: SyntaxNode): boolean {
    if (bindsName(n)) return true
    for (const child of n.namedChildren) {
      if (walk(child)) return true
    }
    return false
  }
  return walk(root)
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
      // For bare identifier calls (`exec(...)`), suppress when a local
      // user-defined function with the same name exists in the file —
      // those are user code, not child_process.exec. Re-bindings from
      // child_process (destructured require / aliased import) do not
      // qualify, so the rule still catches dangerous wrappers.
      if (fn.type === 'identifier' && hasLocalUserDefinedBinding(node, methodName)) {
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
