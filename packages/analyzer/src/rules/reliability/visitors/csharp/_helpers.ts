import type { Node as SyntaxNode } from 'web-tree-sitter'
import { getCSharpRootNode, hasCSharpModifier, walkCSharp } from '../../../_shared/csharp-helpers.js'

/**
 * True when the node sits inside the protected block of a `try` that has at
 * least one `catch` clause. Being inside a catch or finally block of the same
 * try does NOT count — exceptions thrown there are not handled by that try.
 */
export function isInsideCSharpTryWithCatch(node: SyntaxNode): boolean {
  let current: SyntaxNode = node
  let parent: SyntaxNode | null = node.parent
  while (parent) {
    if (parent.type === 'try_statement') {
      const body = parent.childForFieldName('body')
      const hasCatch = parent.namedChildren.some((c) => c?.type === 'catch_clause')
      if (hasCatch && body && current.id === body.id) return true
    }
    current = parent
    parent = parent.parent
  }
  return false
}

/**
 * True when the file looks like an executable entry point: named like one
 * (Program.cs / Main.cs, or under scripts/tools), uses top-level statements,
 * or declares a `static Main` method anywhere in the compilation unit.
 */
export function isCSharpEntryPointFile(node: SyntaxNode, filePath: string): boolean {
  const lowerPath = filePath.toLowerCase()
  const basename = lowerPath.split('/').pop() ?? lowerPath
  if (basename === 'program.cs' || basename === 'main.cs') return true
  if (lowerPath.includes('/scripts/') || lowerPath.includes('/tools/')) return true

  const root = getCSharpRootNode(node)
  // Top-level statements (`var builder = …; app.Run();`) are the modern
  // Program.cs shape — the compiler synthesizes Main around them.
  if (root.namedChildren.some((c) => c?.type === 'global_statement')) return true

  let hasMain = false
  walkCSharp(root, (n) => {
    if (hasMain || n.type !== 'method_declaration') return
    if (n.childForFieldName('name')?.text === 'Main' && hasCSharpModifier(n, 'static')) {
      hasMain = true
    }
  })
  return hasMain
}

/** Simple (unqualified, non-generic) name of a type reference: `System.Net.Http.HttpClient` → 'HttpClient'. */
export function simpleTypeName(text: string): string {
  const last = text.split('.').pop() ?? text
  return last.replace(/<.*$/, '')
}
