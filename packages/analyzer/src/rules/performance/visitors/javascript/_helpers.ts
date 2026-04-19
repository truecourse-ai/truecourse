import type { Node as SyntaxNode } from 'web-tree-sitter'

export const LOOP_TYPES = new Set([
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
])

export const LARGE_PACKAGES = new Set([
  'lodash',
  'moment',
  'rxjs',
  'aws-sdk',
  'antd',
  '@material-ui/core',
  '@mui/material',
])

export const SYNC_FS_METHODS = new Set([
  'readFileSync',
  'writeFileSync',
  'appendFileSync',
  'copyFileSync',
  'mkdirSync',
  'readdirSync',
  'renameSync',
  'rmdirSync',
  'rmSync',
  'statSync',
  'lstatSync',
  'unlinkSync',
  'existsSync',
  'accessSync',
])

export function isInsideLoop(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (LOOP_TYPES.has(current.type)) return true
    // Stop at function boundaries — a loop in an outer scope doesn't count
    if (
      current.type === 'function_declaration' ||
      current.type === 'arrow_function' ||
      current.type === 'method_definition' ||
      current.type === 'function'
    ) {
      return false
    }
    current = current.parent
  }
  return false
}

export function isInsideAsyncFunctionOrHandler(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    // async function or async arrow function
    if (
      current.type === 'function_declaration' ||
      current.type === 'arrow_function' ||
      current.type === 'function' ||
      current.type === 'method_definition'
    ) {
      // Check for async keyword
      if (current.text.startsWith('async ') || current.text.startsWith('async(')) {
        return true
      }
      // Check for Express-style handler: function with (req, res, ...) params
      const params = current.childForFieldName('parameters')
      if (params) {
        const paramTexts = params.namedChildren.map((p) => {
          if (p.type === 'identifier') return p.text
          if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
            const name = p.childForFieldName('pattern') ?? p.namedChildren[0]
            return name?.text ?? ''
          }
          return ''
        })
        if (paramTexts.length >= 2 && paramTexts[0] === 'req' && paramTexts[1] === 'res') {
          return true
        }
      }
    }
    current = current.parent
  }
  return false
}

export function findEnclosingLoop(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent
  while (current) {
    if (LOOP_TYPES.has(current.type)) return current
    if (
      current.type === 'function_declaration' ||
      current.type === 'arrow_function' ||
      current.type === 'method_definition' ||
      current.type === 'function'
    ) {
      return null
    }
    current = current.parent
  }
  return null
}

export function containsMethodCall(node: SyntaxNode, methodNames: Set<string>): boolean {
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function')
    if (fn) {
      let name = ''
      if (fn.type === 'identifier') name = fn.text
      else if (fn.type === 'member_expression') {
        const prop = fn.childForFieldName('property')
        if (prop) name = prop.text
      }
      if (methodNames.has(name)) return true
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && containsMethodCall(child, methodNames)) return true
  }
  return false
}

export function findEnclosingFunctionNode(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent
  while (current) {
    if (
      current.type === 'function_declaration' ||
      current.type === 'arrow_function' ||
      current.type === 'function'
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

export function isInsideHook(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'call_expression') {
      const fn = current.childForFieldName('function')
      if (fn?.type === 'identifier' && (fn.text === 'useMemo' || fn.text === 'useCallback')) {
        return true
      }
    }
    current = current.parent
  }
  return false
}

/**
 * Check if a file is likely a React Server Component.
 * Server components don't re-render on the client, so inline allocations
 * have no performance impact.
 *
 * Detection: file is a .tsx/.jsx file that lacks a 'use client' directive.
 * This only applies to Next.js App Router / React Server Components setups.
 * We check for the presence of Next.js App Router file conventions in the path
 * to avoid false negatives on non-RSC projects.
 */
export function isLikelyServerComponent(filePath: string, sourceCode: string): boolean {
  // Only applies to JSX files
  if (!/\.[tj]sx$/.test(filePath)) return false
  // Only in Next.js App Router paths (contains /app/ directory)
  if (!/\/app\//.test(filePath)) return false
  // If the file has 'use client', it's a client component
  if (sourceCode.includes("'use client'") || sourceCode.includes('"use client"')) return false
  return true
}

export function findContainingStatement(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node
  while (current) {
    if (current.type === 'expression_statement' || current.type === 'lexical_declaration' || current.type === 'variable_declaration') {
      return current
    }
    current = current.parent
  }
  return null
}
