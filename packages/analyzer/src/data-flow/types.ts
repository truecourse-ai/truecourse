import type { SyntaxNode } from 'tree-sitter'
import type { SupportedLanguage } from '@truecourse/shared'

export type DeclarationKind =
  | 'const' | 'let' | 'var'
  | 'function' | 'class' | 'import'
  | 'parameter' | 'global' | 'nonlocal'
  | 'assignment' | 'for-variable' | 'catch-parameter'

export type ScopeKind = 'module' | 'function' | 'block' | 'class' | 'catch' | 'with'

export interface DefSite {
  node: SyntaxNode
  scope: Scope
  isInitializer: boolean
}

export interface UseSite {
  node: SyntaxNode
  scope: Scope
  isTypePosition: boolean
}

export interface Variable {
  name: string
  kind: DeclarationKind
  declarationNode: SyntaxNode
  scope: Scope
  isPrivate: boolean
  defSites: DefSite[]
  useSites: UseSite[]
}

export interface Scope {
  id: number
  kind: ScopeKind
  node: SyntaxNode
  parent: Scope | null
  children: Scope[]
  variables: Map<string, Variable>
}

export interface DataFlowContext {
  rootScope: Scope
  language: SupportedLanguage
  resolveReference(identifierNode: SyntaxNode): Variable | null
  getScopeForNode(node: SyntaxNode): Scope | null
  allVariables(): Variable[]
  shadowedVariables(): Array<{ inner: Variable; outer: Variable }>
  usedBeforeDefined(): Variable[]
  unusedVariables(): Variable[]
  undeclaredReferences(): Array<{ name: string; node: SyntaxNode }>
  privateMembers(): Array<{ variable: Variable; isWritten: boolean; isRead: boolean; isCalled: boolean }>
  returnStatements(functionScope: Scope): SyntaxNode[]
}
