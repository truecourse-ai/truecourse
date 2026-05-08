import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: module-level mutable variables that are lists, dicts, sets without being constants

function isModuleLevel(node: SyntaxNode): boolean {
  // In Python tree-sitter, module-level assignments are:
  //   module -> expression_statement -> assignment
  // So parent is expression_statement and grandparent is module
  const parent = node.parent
  if (!parent) return false
  if (parent.type === 'module') return true
  if (parent.type === 'expression_statement' && parent.parent?.type === 'module') return true
  return false
}

function isMutableInit(node: SyntaxNode): boolean {
  return node.type === 'list' || node.type === 'dictionary' || node.type === 'set'
}

function isConstantName(name: string): boolean {
  return name === name.toUpperCase()
}

// True if the module declares a `threading.Lock()` / `threading.RLock()` /
// `Lock()` / `RLock()` / `asyncio.Lock()` at module scope. The presence of
// any such guard is a strong signal that the writer has already considered
// concurrency for the module's mutable state - suppress the FP rather than
// nag.
/**
 * True if the file is a one-shot CLI script (not an imported
 * module). Script files run from start to finish, exit, and
 * are gone — their module-scope variables are not "shared state
 * across requests" the way they would be in a long-lived
 * web-app module.
 *
 * Two signals:
 *  - Conventional script directory in the path (`/scripts/`,
 *    `/bin/`, `/tools/`, `/cli/`, `/cmd/`).
 *  - Conventional script basename (`__main__.py`, `manage.py`,
 *    or basename ending in `_main.py`).
 *  - Module body contains a call to `argparse.ArgumentParser()`
 *    / `sys.exit()` at top level, or an `if __name__ == "__main__":`
 *    block — strong "this is an entry point" signal.
 */
function isCliScriptFile(filePath: string, moduleNode: SyntaxNode): boolean {
  const segments = filePath.split('/')
  const fileName = segments[segments.length - 1]?.toLowerCase() ?? ''
  if (fileName === '__main__.py' || fileName === 'manage.py') return true
  if (/_main\.py$/.test(fileName)) return true
  const SCRIPT_DIRS = new Set(['scripts', 'bin', 'tools', 'cli', 'cmd'])
  for (let i = 1; i < segments.length - 1; i++) {
    if (SCRIPT_DIRS.has(segments[i].toLowerCase())) return true
  }
  // Inspect top-level statements for script-shape signals.
  // We look for statements OUTSIDE function / class bodies that
  // are clearly imperative entrypoints — calls to argparse,
  // sys.exit, os.remove, file operations, or `if __name__`.
  let topLevelImperativeCalls = 0
  for (let i = 0; i < moduleNode.namedChildCount; i++) {
    const stmt = moduleNode.namedChild(i)
    if (!stmt) continue
    if (stmt.type === 'function_definition' || stmt.type === 'class_definition' ||
        stmt.type === 'decorated_definition' || stmt.type === 'import_statement' ||
        stmt.type === 'import_from_statement' || stmt.type === 'future_import_statement') continue
    const text = stmt.text
    if (/^if\s+__name__\s*==\s*['"]__main__['"]/.test(text)) return true
    if (/\bargparse\.ArgumentParser\s*\(/.test(text)) return true
    // Top-level imperative-call signals (sys.exit, os.remove,
    // shutil.copy, subprocess.run, etc.). Two or more such calls
    // outside any function strongly suggests a script body.
    if (/\b(?:sys\.exit|os\.remove|os\.rename|shutil\.[a-z_]+|subprocess\.(?:run|call|check_call|check_output|Popen))\s*\(/.test(text)) {
      topLevelImperativeCalls++
      if (topLevelImperativeCalls >= 1) return true
    }
  }
  return false
}

function moduleHasLockGuard(moduleNode: SyntaxNode): boolean {
  for (let i = 0; i < moduleNode.namedChildCount; i++) {
    const stmt = moduleNode.namedChild(i)
    if (!stmt) continue
    const inner = stmt.type === 'expression_statement' ? stmt.namedChild(0) : stmt
    if (inner?.type !== 'assignment') continue
    const rhs = inner.childForFieldName('right')
    if (rhs?.type !== 'call') continue
    const fn = rhs.childForFieldName('function')
    if (!fn) continue
    const text = fn.text
    if (
      text === 'threading.Lock' ||
      text === 'threading.RLock' ||
      text === 'threading.Semaphore' ||
      text === 'threading.BoundedSemaphore' ||
      text === 'asyncio.Lock' ||
      text === 'multiprocessing.Lock' ||
      text === 'multiprocessing.RLock' ||
      text === 'Lock' ||
      text === 'RLock'
    ) {
      return true
    }
  }
  return false
}

export const pythonSharedMutableModuleStateVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/shared-mutable-module-state',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    if (!isModuleLevel(node)) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    if (!isMutableInit(right)) return null

    const varName = left.text
    if (isConstantName(varName)) return null // ALL_CAPS are conventions for constants
    if (varName === '__all__') return null // __all__ defines module public API, never mutated at runtime

    // Walk to the module root and check for a colocated Lock declaration.
    let moduleNode: SyntaxNode | null = node.parent
    while (moduleNode && moduleNode.type !== 'module') moduleNode = moduleNode.parent
    if (moduleNode && moduleHasLockGuard(moduleNode)) return null

    // Skip CLI script files — their module-scope variables don't
    // outlive a single script run, so "shared across requests"
    // doesn't apply.
    if (moduleNode && isCliScriptFile(filePath, moduleNode)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Shared mutable state in module scope',
      `\`${varName}\` is a mutable ${right.type} at module level — in server environments this state is shared across all requests, causing race conditions and data leaks.`,
      sourceCode,
      'Move mutable state inside request handlers or use immutable data structures.',
    )
  },
}
