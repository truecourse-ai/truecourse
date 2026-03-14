import { z } from 'zod'

// ---------------------------------------------------------------------------
// Supported Languages
// ---------------------------------------------------------------------------

export const SupportedLanguageSchema = z.enum(['typescript', 'javascript'])
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>

// ---------------------------------------------------------------------------
// Source Location
// ---------------------------------------------------------------------------

export const SourceLocationSchema = z.object({
  filePath: z.string(),
  startLine: z.number(),
  startColumn: z.number(),
  endLine: z.number(),
  endColumn: z.number(),
})

export type SourceLocation = z.infer<typeof SourceLocationSchema>

// ---------------------------------------------------------------------------
// Parameter
// ---------------------------------------------------------------------------

export const ParameterSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  defaultValue: z.string().optional(),
})

export type Parameter = z.infer<typeof ParameterSchema>

// ---------------------------------------------------------------------------
// Function Definition
// ---------------------------------------------------------------------------

export const FunctionDefinitionSchema = z.object({
  name: z.string(),
  params: z.array(ParameterSchema),
  returnType: z.string().optional(),
  isAsync: z.boolean(),
  isExported: z.boolean(),
  location: SourceLocationSchema,
})

export type FunctionDefinition = z.infer<typeof FunctionDefinitionSchema>

// ---------------------------------------------------------------------------
// Class Definition
// ---------------------------------------------------------------------------

export const ClassPropertySchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  isStatic: z.boolean().optional(),
})

export type ClassProperty = z.infer<typeof ClassPropertySchema>

export const ClassDefinitionSchema = z.object({
  name: z.string(),
  methods: z.array(FunctionDefinitionSchema),
  properties: z.array(ClassPropertySchema),
  superClass: z.string().optional(),
  interfaces: z.array(z.string()).optional(),
  decorators: z.array(z.string()).optional(),
  location: SourceLocationSchema,
})

export type ClassDefinition = z.infer<typeof ClassDefinitionSchema>

// ---------------------------------------------------------------------------
// Import Statement
// ---------------------------------------------------------------------------

export const ImportSpecifierSchema = z.object({
  name: z.string(),
  alias: z.string().optional(),
  isDefault: z.boolean(),
  isNamespace: z.boolean(),
})

export type ImportSpecifier = z.infer<typeof ImportSpecifierSchema>

export const ImportStatementSchema = z.object({
  source: z.string(),
  specifiers: z.array(ImportSpecifierSchema),
  isTypeOnly: z.boolean(),
})

export type ImportStatement = z.infer<typeof ImportStatementSchema>

// ---------------------------------------------------------------------------
// Export Statement
// ---------------------------------------------------------------------------

export const ExportStatementSchema = z.object({
  name: z.string(),
  isDefault: z.boolean(),
  source: z.string().optional(),
})

export type ExportStatement = z.infer<typeof ExportStatementSchema>

// ---------------------------------------------------------------------------
// Call Expression
// ---------------------------------------------------------------------------

export const CallExpressionSchema = z.object({
  callee: z.string(),
  arguments: z.array(z.string()).optional(),
  location: SourceLocationSchema,
  callerFunction: z.string().optional(),
})

export type CallExpression = z.infer<typeof CallExpressionSchema>

// ---------------------------------------------------------------------------
// HTTP Call
// ---------------------------------------------------------------------------

export const HttpCallSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  url: z.string(),
  location: SourceLocationSchema,
})

export type HttpCall = z.infer<typeof HttpCallSchema>

// ---------------------------------------------------------------------------
// File Analysis
// ---------------------------------------------------------------------------

export const FileAnalysisSchema = z.object({
  filePath: z.string(),
  language: SupportedLanguageSchema,
  functions: z.array(FunctionDefinitionSchema),
  classes: z.array(ClassDefinitionSchema),
  imports: z.array(ImportStatementSchema),
  exports: z.array(ExportStatementSchema),
  calls: z.array(CallExpressionSchema),
  httpCalls: z.array(HttpCallSchema),
})

export type FileAnalysis = z.infer<typeof FileAnalysisSchema>

// ---------------------------------------------------------------------------
// Module Dependency
// ---------------------------------------------------------------------------

export const ModuleDependencySchema = z.object({
  source: z.string(),
  target: z.string(),
  importedNames: z.array(z.string()),
})

export type ModuleDependency = z.infer<typeof ModuleDependencySchema>
