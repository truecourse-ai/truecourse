import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Unsorted `using` directives. The C# analog of unsorted import specifiers:
 * a contiguous block of plain `using X.Y;` directives should be ordered.
 * Both established .NET orderings are accepted — plain alphabetical and
 * System-first-then-alphabetical (`dotnet_sort_system_directives_first`) —
 * so only blocks sorted under NEITHER convention are flagged. Alias, static,
 * and global usings are conventionally grouped separately and act as block
 * boundaries, as do blank lines and comments (developers group usings
 * deliberately; each group is judged on its own).
 */
function isPlainUsing(directive: SyntaxNode): boolean {
  return !directive.children.some(
    (c) => c && (c.type === 'static' || c.type === 'global' || c.type === '='),
  )
}

function usingTarget(directive: SyntaxNode): string | null {
  for (let i = directive.namedChildren.length - 1; i >= 0; i--) {
    const child = directive.namedChildren[i]
    if (child && (child.type === 'qualified_name' || child.type === 'identifier' || child.type === 'generic_name')) {
      return child.text
    }
  }
  return null
}

const compare = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase())
const isSystem = (name: string) => name === 'System' || name.startsWith('System.')

/** Index of the first directive breaking plain alphabetical order, or -1. */
function alphabeticalBreak(names: string[]): number {
  for (let i = 1; i < names.length; i++) {
    if (compare(names[i - 1]!, names[i]!) > 0) return i
  }
  return -1
}

/** True when the block follows the System-first convention. */
function isSystemFirstSorted(names: string[]): boolean {
  let sawNonSystem = false
  let prevSystem: string | null = null
  let prevNonSystem: string | null = null
  for (const name of names) {
    if (isSystem(name)) {
      if (sawNonSystem) return false
      if (prevSystem !== null && compare(prevSystem, name) > 0) return false
      prevSystem = name
    } else {
      sawNonSystem = true
      if (prevNonSystem !== null && compare(prevNonSystem, name) > 0) return false
      prevNonSystem = name
    }
  }
  return true
}

export const csharpSortingStyleVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/sorting-style',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    const groups: SyntaxNode[][] = []

    function collect(scope: SyntaxNode) {
      let current: SyntaxNode[] = []
      const flush = () => {
        if (current.length > 1) groups.push(current)
        current = []
      }
      for (const child of scope.namedChildren) {
        if (!child) continue
        if (child.type === 'using_directive' && isPlainUsing(child) && usingTarget(child)) {
          const prev = current[current.length - 1]
          // A blank line starts a new group
          if (prev && child.startPosition.row - prev.endPosition.row > 1) flush()
          current.push(child)
          continue
        }
        flush()
        if (child.type === 'namespace_declaration') {
          const declList = child.namedChildren.find((c) => c?.type === 'declaration_list')
          if (declList) collect(declList)
        }
      }
      flush()
    }

    collect(node)

    for (const group of groups) {
      const names = group.map((d) => usingTarget(d)!)
      const breakIndex = alphabeticalBreak(names)
      if (breakIndex === -1) continue
      if (isSystemFirstSorted(names)) continue

      const sorted = [...names].sort(compare)
      return makeViolation(
        this.ruleKey, group[breakIndex]!, filePath, 'low',
        'Unsorted using directives',
        'Using directives are not sorted alphabetically (neither plain nor System-first ordering).',
        sourceCode,
        `Sort the using directives: ${sorted.join(', ')}`,
      )
    }

    return null
  },
}
