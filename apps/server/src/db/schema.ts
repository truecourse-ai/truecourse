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
  insights: many(insights),
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
  insights: many(insights),
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
  insights: many(insights),
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
// insights
// ---------------------------------------------------------------------------

export const insights = pgTable('insights', {
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
  fixPrompt: text('fix_prompt'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const insightsRelations = relations(insights, ({ one }) => ({
  repo: one(repos, {
    fields: [insights.repoId],
    references: [repos.id],
  }),
  analysis: one(analyses, {
    fields: [insights.analysisId],
    references: [analyses.id],
  }),
  targetService: one(services, {
    fields: [insights.targetServiceId],
    references: [services.id],
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
