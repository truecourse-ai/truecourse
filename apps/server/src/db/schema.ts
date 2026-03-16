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
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  lastAnalyzedAt: timestamp('last_analyzed_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const reposRelations = relations(repos, ({ many }) => ({
  analyses: many(analyses),
  violations: many(violations),
  conversations: many(conversations),
}));

// ---------------------------------------------------------------------------
// analyses
// ---------------------------------------------------------------------------

export const analyses = pgTable('analyses', {
  id: uuid('id').defaultRandom().primaryKey(),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repos.id, { onDelete: 'cascade' }),
  branch: text('branch'),
  architecture: text('architecture').notNull(), // 'monolith' | 'microservices'
  metadata: jsonb('metadata'),
  nodePositions: jsonb('node_positions'), // { [serviceId]: { x, y } }
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const analysesRelations = relations(analyses, ({ one, many }) => ({
  repo: one(repos, {
    fields: [analyses.repoId],
    references: [repos.id],
  }),
  services: many(services),
  serviceDependencies: many(serviceDependencies),
  layers: many(layers),
  layerDependencies: many(layerDependencies),
  violations: many(violations),
  databases: many(databases),
  modules: many(modules),
  methods: many(methods),
  moduleDeps: many(moduleDeps),
}));

// ---------------------------------------------------------------------------
// services
// ---------------------------------------------------------------------------

export const services = pgTable('services', {
  id: uuid('id').defaultRandom().primaryKey(),
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
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
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
  id: uuid('id').defaultRandom().primaryKey(),
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
  id: uuid('id').defaultRandom().primaryKey(),
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
// layer_dependencies (cross-layer dependencies with violation detection)
// ---------------------------------------------------------------------------

export const layerDependencies = pgTable('layer_dependencies', {
  id: uuid('id').defaultRandom().primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  sourceServiceName: text('source_service_name').notNull(),
  sourceLayer: text('source_layer').notNull(),
  targetServiceName: text('target_service_name').notNull(),
  targetLayer: text('target_layer').notNull(),
  dependencyCount: integer('dependency_count').notNull(),
  isViolation: boolean('is_violation').notNull().default(false),
  violationReason: text('violation_reason'),
});

export const layerDependenciesRelations = relations(layerDependencies, ({ one }) => ({
  analysis: one(analyses, {
    fields: [layerDependencies.analysisId],
    references: [analyses.id],
  }),
}));

// ---------------------------------------------------------------------------
// violations
// ---------------------------------------------------------------------------

export const violations = pgTable('violations', {
  id: uuid('id').defaultRandom().primaryKey(),
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
  fixPrompt: text('fix_prompt'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
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
// conversations
// ---------------------------------------------------------------------------

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repos.id, { onDelete: 'cascade' }),
  branch: text('branch'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    repo: one(repos, {
      fields: [conversations.repoId],
      references: [repos.id],
    }),
    messages: many(messages),
  })
);

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  nodeContext: jsonb('node_context'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

// ---------------------------------------------------------------------------
// databases (detected database instances per analysis)
// ---------------------------------------------------------------------------

export const databases = pgTable('databases', {
  id: uuid('id').defaultRandom().primaryKey(),
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
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
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
  id: uuid('id').defaultRandom().primaryKey(),
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
  id: uuid('id').defaultRandom().primaryKey(),
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
  id: uuid('id').defaultRandom().primaryKey(),
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
  id: uuid('id').defaultRandom().primaryKey(),
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
  id: uuid('id').defaultRandom().primaryKey(),
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
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// diff_checks (persisted diff analysis results)
// ---------------------------------------------------------------------------

export const diffChecks = pgTable('diff_checks', {
  id: uuid('id').defaultRandom().primaryKey(),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repos.id, { onDelete: 'cascade' }),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  changedFiles: jsonb('changed_files').notNull(), // Array<{ path, status }>
  resolvedInsightIds: jsonb('resolved_insight_ids').notNull(), // string[]
  newInsights: jsonb('new_insights').notNull(), // InsightResponse[]
  affectedNodeIds: jsonb('affected_node_ids').notNull(), // { services, layers, modules, methods }
  summary: jsonb('summary').notNull(), // { newCount, resolvedCount }
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const diffChecksRelations = relations(diffChecks, ({ one }) => ({
  repo: one(repos, {
    fields: [diffChecks.repoId],
    references: [repos.id],
  }),
  analysis: one(analyses, {
    fields: [diffChecks.analysisId],
    references: [analyses.id],
  }),
}));
