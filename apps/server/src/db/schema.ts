import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// repos
// ---------------------------------------------------------------------------

export const repos = pgTable('repos', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  lastAnalyzedAt: timestamp('last_analyzed_at', { mode: 'date', withTimezone: true }),
  /** Per-repo enabled rule categories (null = use global default) */
  enabledCategories: jsonb('enabled_categories').$type<string[] | null>(),
  /** Per-repo LLM rules toggle (null = use global default) */
  enableLlmRules: boolean('enable_llm_rules'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});

export const reposRelations = relations(repos, ({ many }) => ({
  analyses: many(analyses),
  violations: many(violations),
}));

// ---------------------------------------------------------------------------
// analyses
// ---------------------------------------------------------------------------

export const analyses = pgTable('analyses', {
  id: uuid('id').primaryKey(),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repos.id, { onDelete: 'cascade' }),
  branch: text('branch'),
  status: text('status').notNull().default('completed'), // 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed'
  architecture: text('architecture').notNull(), // 'monolith' | 'microservices'
  metadata: jsonb('metadata'),
  commitHash: text('commit_hash'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});

export const analysesRelations = relations(analyses, ({ one, many }) => ({
  repo: one(repos, {
    fields: [analyses.repoId],
    references: [repos.id],
  }),
  services: many(services),
  serviceDependencies: many(serviceDependencies),
  layers: many(layers),
  violations: many(violations),
  databases: many(databases),
  modules: many(modules),
  methods: many(methods),
  moduleDeps: many(moduleDeps),
  flows: many(flows),
  usageRecords: many(analysisUsage),
}));

// ---------------------------------------------------------------------------
// services
// ---------------------------------------------------------------------------

export const services = pgTable('services', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull(),
  type: text('type').notNull(), // ServiceType
  framework: text('framework'),
  fileCount: integer('file_count'),
  description: text('description'),
  layerSummary: jsonb('layer_summary'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});

export const servicesRelations = relations(services, ({ one, many }) => ({
  analysis: one(analyses, {
    fields: [services.analysisId],
    references: [analyses.id],
  }),
  sourceEdges: many(serviceDependencies, { relationName: 'sourceService' }),
  targetEdges: many(serviceDependencies, { relationName: 'targetService' }),
  layers: many(layers),
  violations: many(violations),
}));

// ---------------------------------------------------------------------------
// service_dependencies
// ---------------------------------------------------------------------------

export const serviceDependencies = pgTable('service_dependencies', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  sourceServiceId: uuid('source_service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  targetServiceId: uuid('target_service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  dependencyCount: integer('dependency_count'),
  dependencyType: text('dependency_type'),
});

export const serviceDependenciesRelations = relations(
  serviceDependencies,
  ({ one }) => ({
    analysis: one(analyses, {
      fields: [serviceDependencies.analysisId],
      references: [analyses.id],
    }),
    sourceService: one(services, {
      fields: [serviceDependencies.sourceServiceId],
      references: [services.id],
      relationName: 'sourceService',
    }),
    targetService: one(services, {
      fields: [serviceDependencies.targetServiceId],
      references: [services.id],
      relationName: 'targetService',
    }),
  })
);

// ---------------------------------------------------------------------------
// layers (per-service layer details)
// ---------------------------------------------------------------------------

export const layers = pgTable('layers', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  serviceName: text('service_name').notNull(),
  layer: text('layer').notNull(), // 'data' | 'api' | 'service' | 'external'
  fileCount: integer('file_count').notNull(),
  filePaths: jsonb('file_paths').notNull(), // string[]
  confidence: integer('confidence').notNull(), // stored as 0-100
  evidence: jsonb('evidence').notNull(), // string[]
});

export const layersRelations = relations(layers, ({ one }) => ({
  analysis: one(analyses, {
    fields: [layers.analysisId],
    references: [analyses.id],
  }),
  service: one(services, {
    fields: [layers.serviceId],
    references: [services.id],
  }),
}));

// ---------------------------------------------------------------------------
// violations
// ---------------------------------------------------------------------------

export const violations = pgTable('violations', {
  id: uuid('id').primaryKey(),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repos.id, { onDelete: 'cascade' }),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  severity: text('severity').notNull(),
  status: text('status').notNull().default('new'), // 'new' | 'unchanged' | 'resolved'
  targetServiceId: uuid('target_service_id').references(() => services.id, {
    onDelete: 'set null',
  }),
  targetDatabaseId: uuid('target_database_id').references(() => databases.id, {
    onDelete: 'set null',
  }),
  targetModuleId: uuid('target_module_id').references(() => modules.id, {
    onDelete: 'set null',
  }),
  targetMethodId: uuid('target_method_id').references(() => methods.id, {
    onDelete: 'set null',
  }),
  targetTable: text('target_table'),
  relatedServiceId: uuid('related_service_id').references(() => services.id, { onDelete: 'set null' }),
  relatedModuleId: uuid('related_module_id').references(() => modules.id, { onDelete: 'set null' }),
  fixPrompt: text('fix_prompt'),
  ruleKey: text('rule_key').notNull(),
  firstSeenAnalysisId: uuid('first_seen_analysis_id').references(() => analyses.id, {
    onDelete: 'set null',
  }),
  firstSeenAt: timestamp('first_seen_at', { mode: 'date', withTimezone: true }),
  previousViolationId: uuid('previous_violation_id'),
  resolvedAt: timestamp('resolved_at', { mode: 'date', withTimezone: true }),
  /** Code violation fields (nullable — filled when type = 'code') */
  filePath: text('file_path'),
  lineStart: integer('line_start'),
  lineEnd: integer('line_end'),
  columnStart: integer('column_start'),
  columnEnd: integer('column_end'),
  snippet: text('snippet'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});

export const violationsRelations = relations(violations, ({ one }) => ({
  repo: one(repos, {
    fields: [violations.repoId],
    references: [repos.id],
  }),
  analysis: one(analyses, {
    fields: [violations.analysisId],
    references: [analyses.id],
  }),
  targetService: one(services, {
    fields: [violations.targetServiceId],
    references: [services.id],
  }),
  targetDatabase: one(databases, {
    fields: [violations.targetDatabaseId],
    references: [databases.id],
  }),
  targetModule: one(modules, {
    fields: [violations.targetModuleId],
    references: [modules.id],
  }),
  targetMethod: one(methods, {
    fields: [violations.targetMethodId],
    references: [methods.id],
  }),
}));

// ---------------------------------------------------------------------------
// databases (detected database instances per analysis)
// ---------------------------------------------------------------------------

export const databases = pgTable('databases', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'postgres' | 'redis' | 'mongodb' | 'mysql' | 'sqlite'
  driver: text('driver').notNull(),
  connectionConfig: jsonb('connection_config'), // env var, docker service, etc.
  tables: jsonb('tables'), // TableInfo[]
  dbRelations: jsonb('db_relations'), // RelationInfo[]
  connectedServices: jsonb('connected_services'), // string[]
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});

export const databasesRelations = relations(databases, ({ one, many }) => ({
  analysis: one(analyses, {
    fields: [databases.analysisId],
    references: [analyses.id],
  }),
  connections: many(databaseConnections),
}));

// ---------------------------------------------------------------------------
// database_connections (which service uses which database)
// ---------------------------------------------------------------------------

export const databaseConnections = pgTable('database_connections', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  databaseId: uuid('database_id')
    .notNull()
    .references(() => databases.id, { onDelete: 'cascade' }),
  driver: text('driver').notNull(),
});

export const databaseConnectionsRelations = relations(
  databaseConnections,
  ({ one }) => ({
    analysis: one(analyses, {
      fields: [databaseConnections.analysisId],
      references: [analyses.id],
    }),
    service: one(services, {
      fields: [databaseConnections.serviceId],
      references: [services.id],
    }),
    database: one(databases, {
      fields: [databaseConnections.databaseId],
      references: [databases.id],
    }),
  })
);

// ---------------------------------------------------------------------------
// modules (classes/interfaces/standalone modules per layer)
// ---------------------------------------------------------------------------

export const modules = pgTable('modules', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  layerId: uuid('layer_id')
    .notNull()
    .references(() => layers.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // 'class' | 'interface' | 'standalone'
  filePath: text('file_path').notNull(),
  methodCount: integer('method_count').notNull().default(0),
  propertyCount: integer('property_count').notNull().default(0),
  importCount: integer('import_count').notNull().default(0),
  exportCount: integer('export_count').notNull().default(0),
  superClass: text('super_class'),
  lineCount: integer('line_count'),
});

export const modulesRelations = relations(modules, ({ one, many }) => ({
  analysis: one(analyses, {
    fields: [modules.analysisId],
    references: [analyses.id],
  }),
  layer: one(layers, {
    fields: [modules.layerId],
    references: [layers.id],
  }),
  service: one(services, {
    fields: [modules.serviceId],
    references: [services.id],
  }),
  methods: many(methods),
}));

// ---------------------------------------------------------------------------
// methods (functions/methods within modules)
// ---------------------------------------------------------------------------

export const methods = pgTable('methods', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  moduleId: uuid('module_id')
    .notNull()
    .references(() => modules.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  signature: text('signature').notNull(),
  paramCount: integer('param_count').notNull().default(0),
  returnType: text('return_type'),
  isAsync: boolean('is_async').notNull().default(false),
  isExported: boolean('is_exported').notNull().default(false),
  lineCount: integer('line_count'),
  statementCount: integer('statement_count'),
  maxNestingDepth: integer('max_nesting_depth'),
});

export const methodsRelations = relations(methods, ({ one }) => ({
  analysis: one(analyses, {
    fields: [methods.analysisId],
    references: [analyses.id],
  }),
  module: one(modules, {
    fields: [methods.moduleId],
    references: [modules.id],
  }),
}));

// ---------------------------------------------------------------------------
// module_dependencies (import-based dependencies between modules)
// ---------------------------------------------------------------------------

export const moduleDeps = pgTable('module_dependencies', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  sourceModuleId: uuid('source_module_id')
    .notNull()
    .references(() => modules.id, { onDelete: 'cascade' }),
  targetModuleId: uuid('target_module_id')
    .notNull()
    .references(() => modules.id, { onDelete: 'cascade' }),
  importedNames: jsonb('imported_names').notNull(), // string[]
  dependencyCount: integer('dependency_count').notNull().default(1),
});

export const moduleDepsRelations = relations(moduleDeps, ({ one }) => ({
  analysis: one(analyses, {
    fields: [moduleDeps.analysisId],
    references: [analyses.id],
  }),
  sourceModule: one(modules, {
    fields: [moduleDeps.sourceModuleId],
    references: [modules.id],
    relationName: 'sourceModule',
  }),
  targetModule: one(modules, {
    fields: [moduleDeps.targetModuleId],
    references: [modules.id],
    relationName: 'targetModule',
  }),
}));

// ---------------------------------------------------------------------------
// method_dependencies (call-based dependencies between methods)
// ---------------------------------------------------------------------------

export const methodDeps = pgTable('method_dependencies', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  sourceMethodId: uuid('source_method_id')
    .notNull()
    .references(() => methods.id, { onDelete: 'cascade' }),
  targetMethodId: uuid('target_method_id')
    .notNull()
    .references(() => methods.id, { onDelete: 'cascade' }),
  callCount: integer('call_count').notNull().default(1),
});

export const methodDepsRelations = relations(methodDeps, ({ one }) => ({
  analysis: one(analyses, {
    fields: [methodDeps.analysisId],
    references: [analyses.id],
  }),
  sourceMethod: one(methods, {
    fields: [methodDeps.sourceMethodId],
    references: [methods.id],
    relationName: 'sourceMethod',
  }),
  targetMethod: one(methods, {
    fields: [methodDeps.targetMethodId],
    references: [methods.id],
    relationName: 'targetMethod',
  }),
}));

// ---------------------------------------------------------------------------
// rules (analysis rules — seeded from defaults, configurable per instance)
// ---------------------------------------------------------------------------

export const rules = pgTable('rules', {
  key: text('key').primaryKey(),
  category: text('category').notNull(), // 'service' | 'module' | 'database'
  name: text('name').notNull(),
  description: text('description').notNull(),
  prompt: text('prompt'),
  enabled: boolean('enabled').notNull().default(true),
  severity: text('severity').notNull(), // 'info' | 'low' | 'medium' | 'high' | 'critical'
  type: text('type').notNull(), // 'deterministic' | 'llm'
  contextRequirement: jsonb('context_requirement'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});


// ---------------------------------------------------------------------------
// flows (execution paths from entry points through call graph)
// ---------------------------------------------------------------------------

export const flows = pgTable('flows', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  entryService: text('entry_service').notNull(),
  entryMethod: text('entry_method').notNull(),
  category: text('category').notNull(),
  trigger: text('trigger').notNull(), // 'http' | 'event' | 'cron' | 'startup'
  stepCount: integer('step_count').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});

export const flowsRelations = relations(flows, ({ one, many }) => ({
  analysis: one(analyses, {
    fields: [flows.analysisId],
    references: [analyses.id],
  }),
  steps: many(flowSteps),
}));

// ---------------------------------------------------------------------------
// flow_steps (individual steps within a flow)
// ---------------------------------------------------------------------------

export const flowSteps = pgTable('flow_steps', {
  id: uuid('id').primaryKey(),
  flowId: uuid('flow_id')
    .notNull()
    .references(() => flows.id, { onDelete: 'cascade' }),
  stepOrder: integer('step_order').notNull(),
  sourceService: text('source_service').notNull(),
  sourceModule: text('source_module').notNull(),
  sourceMethod: text('source_method').notNull(),
  targetService: text('target_service').notNull(),
  targetModule: text('target_module').notNull(),
  targetMethod: text('target_method').notNull(),
  stepType: text('step_type').notNull(), // 'call' | 'http' | 'db-read' | 'db-write' | 'event'
  dataDescription: text('data_description'),
  isAsync: boolean('is_async').notNull().default(false),
  isConditional: boolean('is_conditional').notNull().default(false),
});

export const flowStepsRelations = relations(flowSteps, ({ one }) => ({
  flow: one(flows, {
    fields: [flowSteps.flowId],
    references: [flows.id],
  }),
}));

// ---------------------------------------------------------------------------
// analysis_usage (LLM token usage per call per analysis)
// ---------------------------------------------------------------------------

export const analysisUsage = pgTable('analysis_usage', {
  id: uuid('id').primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // 'anthropic' | 'openai' | 'claude-code'
  callType: text('call_type').notNull(), // 'service' | 'database' | 'module' | 'code' | 'enrichment' | 'flow'
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  costUsd: text('cost_usd'), // nullable — stored as string for precision
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});

export const analysisUsageRelations = relations(analysisUsage, ({ one }) => ({
  analysis: one(analyses, {
    fields: [analysisUsage.analysisId],
    references: [analyses.id],
  }),
}));
