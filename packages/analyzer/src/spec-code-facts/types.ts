import type ts from 'typescript'
import type { CodeFact, SourceRange } from '@truecourse/shared'

export interface CodeFactExtractionError {
  sourceFile: string
  extractor?: { name: string; version: string }
  message: string
}

export interface CodeFactExtractionResult {
  facts: CodeFact[]
  errors: CodeFactExtractionError[]
}

export interface SourceUnit {
  absPath: string
  sourceFile: string
  content: string
  ast: ts.SourceFile
  facts: CodeFact[]
  errors: CodeFactExtractionError[]
}

export interface RouteRegistration {
  sourceFile: string
  sourceRange: SourceRange
  target: string
  method: string
  path: string
  handlerName?: string
  middlewares: string[]
  statusCodes: number[]
  requestFields: string[]
}

export interface RouterMount {
  sourceFile: string
  target: string
  prefix: string
  routerRef: string
}

export interface ImportRef {
  localName: string
  targetFile: string
}

export interface FileRouteModel {
  routes: RouteRegistration[]
  mounts: RouterMount[]
  imports: ImportRef[]
  routerNames: Set<string>
}
