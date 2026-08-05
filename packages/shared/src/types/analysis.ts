import { z } from 'zod'

// ---------------------------------------------------------------------------
// Supported Languages
// ---------------------------------------------------------------------------

export const SupportedLanguageSchema = z.enum(['typescript', 'tsx', 'javascript', 'python', 'csharp'])
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
  lineCount: z.number().optional(),
  statementCount: z.number().optional(),
  maxNestingDepth: z.number().optional(),
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
  // True if the import is inside a function body (deferred import) rather
  // than at module level. Python uses this pattern to break circular deps.
  isFunctionScoped: z.boolean().optional(),
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
// External HTTP reference
// ---------------------------------------------------------------------------

/**
 * ONE http(s) URL literal written in the source, pointing at a host that is
 * plausibly SOMEONE ELSE'S server — the raw material for detecting a third party a
 * repo talks to with a bare `fetch` and no SDK import.
 *
 * It is deliberately a LITERAL fact, not a service identity: the grouping of hosts
 * into a service (`geocoding-api.open-meteo.com` + `api.open-meteo.com` →
 * `open-meteo`) happens later, in the analyzer's detector, so the file-level fact
 * stays re-groupable.
 *
 * `envVar` is filled only when the SOURCE STRUCTURE binds one to this URL — an
 * env-read in the same initializer (`process.env.FOO ?? 'https://…'`) or a defaults
 * map whose KEY is the variable name. A name-only guess is never recorded here; the
 * detector applies that looser tier itself, at a lower confidence.
 */
export const ExternalHttpRefSchema = z.object({
  /** The literal as written, truncated at the first interpolation. */
  url: z.string(),
  /** Lowercased hostname of {@link url}. */
  host: z.string(),
  /** The env var that overrides this base URL, when the source binds one to it. */
  envVar: z.string().optional(),
  location: SourceLocationSchema,
})

export type ExternalHttpRef = z.infer<typeof ExternalHttpRefSchema>

// ---------------------------------------------------------------------------
// Datastore connection URL
// ---------------------------------------------------------------------------

/**
 * ONE datastore connection-URL literal written in the source
 * (`postgres://localhost:5432/weather`, `redis://localhost:6379`) — harvested by
 * the SAME pass, and with the same env-association rules, as
 * {@link ExternalHttpRefSchema} — the external-HTTP harvest's machinery, put to
 * work for the generated datastore.
 *
 * It is the app's own statement of what datastore it expects and where, which is
 * exactly what the recipe proposer needs to GENERATE that datastore for a repo
 * that ships no compose file. Like the http refs this is a LITERAL fact — the
 * scheme is recorded as written and the engine/image mapping happens later, in the
 * proposer, so an unknown scheme costs a proposal and never a wrong container.
 */
export const DatastoreUrlRefSchema = z.object({
  /** The literal as written, truncated at the first interpolation. */
  url: z.string(),
  /** Lowercased URL scheme without the colon (`postgres`, `mysql`, `mongodb`, `redis`). */
  scheme: z.string(),
  /** The env var that overrides this connection URL, when the source binds one to it. */
  envVar: z.string().optional(),
  location: SourceLocationSchema,
})

export type DatastoreUrlRef = z.infer<typeof DatastoreUrlRefSchema>

// ---------------------------------------------------------------------------
// Request contract (inbound)
// ---------------------------------------------------------------------------

/**
 * ONE field a route's handler reads off the request. `required` is TRUE only when
 * the source SAYS so — a zod key without `.optional()`, a non-optional property of
 * the validator's declared return shape, a `if (!body.x) → 400` guard. A field the
 * handler demonstrably reads but whose requiredness is not statically visible is
 * `'unknown'`, never a guessed `false`: "we did not look" and "it is optional" are
 * different answers and a scenario author must be able to tell them apart.
 */
export const RequestFieldSchema = z.object({
  name: z.string(),
  required: z.union([z.boolean(), z.literal('unknown')]),
})

export type RequestField = z.infer<typeof RequestFieldSchema>

/**
 * What ONE route registration says about the request it accepts — harvested from
 * the handler's own body, never from a doc. Everything here is statically visible
 * near the handler; anything that would need type-checking or a cross-file
 * inference the analyzer cannot make honestly is left out.
 *
 * `bodyValidatorRefs` / `queryValidatorRefs` are the ONE deliberate indirection: a
 * handler that hands `req.body` to a named function (`parseSignupBody(req.body)`)
 * has told us where its contract lives without telling us what it is. The symbol
 * is recorded here and resolved against {@link RequestValidatorSchema} by the
 * repo-level join, which is the only layer that sees every file.
 */
export const RequestContractSchema = z.object({
  bodyFields: z.array(RequestFieldSchema).optional(),
  queryFields: z.array(RequestFieldSchema).optional(),
  /** Symbols the handler hands `req.body` to, unresolved at file level. */
  bodyValidatorRefs: z.array(z.string()).optional(),
  /** Symbols the handler hands `req.query` to, unresolved at file level. */
  queryValidatorRefs: z.array(z.string()).optional(),
})

export type RequestContract = z.infer<typeof RequestContractSchema>

/**
 * A function that validates a request record — the other half of the indirection
 * above. Harvested per file for every top-level function whose first parameter is
 * read as a record; only the ones a route actually names are ever joined, so an
 * unreferenced entry costs nothing.
 */
export const RequestValidatorSchema = z.object({
  /** The function's own symbol — the join key. */
  name: z.string(),
  fields: z.array(RequestFieldSchema),
  location: SourceLocationSchema,
})

export type RequestValidator = z.infer<typeof RequestValidatorSchema>

/**
 * A request contract keyed by the OPERATION it belongs to — the repo-level product
 * of joining route registrations (path composed with their mount prefix, exactly as
 * journeys compose it) with the validator symbols they name. This is the shape the
 * authoring prompt renders per journey.
 */
export const ApiRequestContractSchema = z.object({
  /** Uppercase HTTP method. */
  method: z.string(),
  /** Canonical path template — identical to the api journey's `entry.path`. */
  path: z.string(),
  bodyFields: z.array(RequestFieldSchema).optional(),
  queryFields: z.array(RequestFieldSchema).optional(),
})

export type ApiRequestContract = z.infer<typeof ApiRequestContractSchema>

// ---------------------------------------------------------------------------
// Outbound request
// ---------------------------------------------------------------------------

/** The value of a query param / header the source computes rather than writes. */
export const DYNAMIC_VALUE = '<dynamic>'

export const OutboundQueryParamSchema = z.object({
  key: z.string(),
  /** The literal as written, or {@link DYNAMIC_VALUE} when it is computed. */
  value: z.string(),
})

export type OutboundQueryParam = z.infer<typeof OutboundQueryParamSchema>

export const OutboundHeaderSchema = z.object({
  name: z.string(),
  value: z.string(),
})

export type OutboundHeader = z.infer<typeof OutboundHeaderSchema>

/**
 * One field the app READS off an upstream's parsed response, as a dotted path
 * (`current.time`, `results[0].latitude`). `hint` is recorded only when the source
 * itself validates the value in a LOCALLY OBVIOUS way — a numeric wrapper applied
 * right there, a `typeof x === 'string'`, an `Array.isArray(x)`. It is never a
 * type inference.
 */
export const OutboundResponseFieldSchema = z.object({
  path: z.string(),
  hint: z.enum(['number', 'string', 'array', 'object']).optional(),
})

export type OutboundResponseField = z.infer<typeof OutboundResponseFieldSchema>

/**
 * How the app CONSTRUCTS one outbound HTTP request, and which response fields it
 * reads back. The grounding a `setup.http` stub needs: a stub that answers a
 * different path, or a payload missing a field the app validates, is rejected by
 * the app itself — which reads as an upstream failure and turns the scenario red
 * for a reason that has nothing to do with the claim.
 *
 * Only STATICALLY KNOWABLE facts land here: literal path, literal query keys
 * (values verbatim or {@link DYNAMIC_VALUE}), literal headers, and the response
 * property names read in the SAME function. Nothing that would need cross-file
 * inference — the base URL of a request whose origin comes in as a parameter stays
 * an unresolved `baseExpr`, which is the honest answer.
 */
export const OutboundRequestSchema = z.object({
  /** How the request's ORIGIN is written — the join to a detected external service. */
  urlRef: z.object({
    /** Verbatim source text of the base argument (`baseUrl`, `config.forecastBaseUrl`). */
    baseExpr: z.string().optional(),
    /** Hostname, when the base is an absolute URL literal. */
    host: z.string().optional(),
    /** The env var, when the base expression IS an env read. */
    envVar: z.string().optional(),
  }),
  /** Uppercase HTTP method — `GET` when the call site declares none. */
  method: z.string(),
  /** The path literal passed to `new URL(path, base)`. */
  pathLiteral: z.string().optional(),
  queryParams: z.array(OutboundQueryParamSchema),
  headers: z.array(OutboundHeaderSchema).optional(),
  responseFieldsRead: z.array(OutboundResponseFieldSchema),
  location: SourceLocationSchema,
})

export type OutboundRequest = z.infer<typeof OutboundRequestSchema>

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export const RouteRegistrationSchema = z.object({
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL']),
  path: z.string(),
  handlerName: z.string(),
  /** What the handler reads off the request; absent when nothing was visible. */
  requestContract: RequestContractSchema.optional(),
  location: SourceLocationSchema,
})

export type RouteRegistration = z.infer<typeof RouteRegistrationSchema>

export const RouterMountSchema = z.object({
  path: z.string(),
  routerName: z.string(),
  location: SourceLocationSchema,
})

export type RouterMount = z.infer<typeof RouterMountSchema>

// ---------------------------------------------------------------------------
// CLI Command
// ---------------------------------------------------------------------------

/** One flag a command accepts, canonicalized to its long form when it has one. */
export const CliCommandFlagSchema = z.object({
  /** `--json`, `--limit`, `-y` — the value placeholder is stripped. */
  flag: z.string(),
  description: z.string().optional(),
  /** The command refuses to run without it (`requiredOption`, `demandOption`). */
  required: z.boolean().optional(),
  /** It takes a value (`--limit <n>`, `--tag [name]`) rather than being a switch. */
  takesValue: z.boolean().optional(),
  /** The value placeholder as declared — `mode` from `--transport <mode>`. */
  valueHint: z.string().optional(),
  /** The closed value set, when the declaration names one. */
  choices: z.array(z.string()).optional(),
})

export type CliCommandFlag = z.infer<typeof CliCommandFlagSchema>

/**
 * One command a CLI framework registers: its argv PATH (`["spec","docs","exclude"]`
 * for a twice-nested subcommand), the flags it accepts, and where it was declared.
 * The path is the user-facing surface — the program's own name is never part of it.
 */
export const CliCommandSchema = z.object({
  /** Last segment of {@link path} — the command word itself. */
  name: z.string(),
  /** Full argv path from the program root, outermost first. */
  path: z.array(z.string()),
  flags: z.array(CliCommandFlagSchema),
  description: z.string().optional(),
  /** The action/handler symbol, when it is a named function (arrow bodies resolve
   *  to the single call they make; ambiguous bodies leave this unset). */
  handlerName: z.string().optional(),
  location: SourceLocationSchema,
})

export type CliCommand = z.infer<typeof CliCommandSchema>

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
  routeRegistrations: z.array(RouteRegistrationSchema).optional(),
  routerMounts: z.array(RouterMountSchema).optional(),
  cliCommands: z.array(CliCommandSchema).optional(),
  /** http(s) URL literals naming a third-party host; absent when none. */
  externalHttpRefs: z.array(ExternalHttpRefSchema).optional(),
  /**
   * Env vars this file READS whose NAME reads like a base-URL override
   * (`…_BASE_URL`, `…_HOST`, `…_ENDPOINT`) but which no URL literal is bound to.
   * The lower-confidence tier: only a name match to a detected service can attach
   * one, and it never carries a default URL.
   */
  urlEnvReads: z.array(z.string()).optional(),
  /** Datastore connection-URL literals (`postgres://…`); absent when none. */
  datastoreUrlRefs: z.array(DatastoreUrlRefSchema).optional(),
  /** How this file constructs its outbound HTTP requests; absent when none. */
  outboundRequests: z.array(OutboundRequestSchema).optional(),
  /** Request-validating functions declared here, joined by name to the routes that
   *  hand them `req.body` / `req.query`; absent when none. */
  requestValidators: z.array(RequestValidatorSchema).optional(),
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

// ---------------------------------------------------------------------------
// Module Info (class, interface, or standalone file module)
// ---------------------------------------------------------------------------

export const ModuleKindSchema = z.enum(['class', 'interface', 'standalone'])
export type ModuleKind = z.infer<typeof ModuleKindSchema>

export const ModuleInfoSchema = z.object({
  name: z.string(),
  filePath: z.string(),
  kind: ModuleKindSchema,
  serviceName: z.string(),
  layerName: z.string(),
  methodCount: z.number(),
  propertyCount: z.number(),
  importCount: z.number(),
  exportCount: z.number(),
  superClass: z.string().optional(),
  /** 1-based source span of the module. Class modules get the class's
   *  `ClassDefinition.location` range; standalone/file modules span the
   *  whole file (1..lineCount). Used by module-scope arch violations
   *  (`god-module`, `unused-export` on a class, layer violations) so
   *  every violation with a `filePath` can carry a line range. */
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  lineCount: z.number().optional(),
})

export type ModuleInfo = z.infer<typeof ModuleInfoSchema>

// ---------------------------------------------------------------------------
// Method Info (function or class method)
// ---------------------------------------------------------------------------

export const MethodInfoSchema = z.object({
  name: z.string(),
  moduleName: z.string(),
  serviceName: z.string(),
  filePath: z.string(),
  signature: z.string(),
  paramCount: z.number(),
  returnType: z.string().optional(),
  isAsync: z.boolean(),
  isExported: z.boolean(),
  /** 1-based source position of the method/function. Preserved from
   *  `FunctionDefinition.location` so downstream rules can emit violations
   *  that point at the exact method rather than the whole file. */
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  lineCount: z.number().optional(),
  statementCount: z.number().optional(),
  maxNestingDepth: z.number().optional(),
  /** Method is called implicitly by the runtime (e.g., Python __init__, __str__, JS constructor) */
  isImplicitCall: z.boolean().optional(),
})

export type MethodInfo = z.infer<typeof MethodInfoSchema>

// ---------------------------------------------------------------------------
// Module Dependency (import-based, between modules)
// ---------------------------------------------------------------------------

export const ModuleLevelDependencySchema = z.object({
  sourceModule: z.string(),
  sourceService: z.string(),
  sourceFilePath: z.string().optional(),
  targetModule: z.string(),
  targetService: z.string(),
  targetFilePath: z.string().optional(),
  importedNames: z.array(z.string()),
})

export type ModuleLevelDependency = z.infer<typeof ModuleLevelDependencySchema>

// ---------------------------------------------------------------------------
// Method Dependency (call-based, between methods)
// ---------------------------------------------------------------------------

export const MethodLevelDependencySchema = z.object({
  callerMethod: z.string(),
  callerModule: z.string(),
  callerService: z.string(),
  callerFilePath: z.string().optional(),
  calleeMethod: z.string(),
  calleeModule: z.string(),
  calleeService: z.string(),
  calleeFilePath: z.string().optional(),
  callCount: z.number(),
})

export type MethodLevelDependency = z.infer<typeof MethodLevelDependencySchema>
