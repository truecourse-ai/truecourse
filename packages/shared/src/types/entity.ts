import { z } from 'zod'
import { HttpCallSchema } from './analysis.js'

// ---------------------------------------------------------------------------
// Entity Field
// ---------------------------------------------------------------------------

export const EntityFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  isPrimaryKey: z.boolean().optional(),
  isNullable: z.boolean().optional(),
  decorators: z.array(z.string()).optional(),
})

export type EntityField = z.infer<typeof EntityFieldSchema>

// ---------------------------------------------------------------------------
// Entity Relationship
// ---------------------------------------------------------------------------

export const EntityRelationshipSchema = z.object({
  type: z.enum(['oneToOne', 'oneToMany', 'manyToOne', 'manyToMany']),
  targetEntity: z.string(),
  fieldName: z.string(),
})

export type EntityRelationship = z.infer<typeof EntityRelationshipSchema>

// ---------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------

export const EntitySchema = z.object({
  name: z.string(),
  service: z.string(),
  framework: z.string(),
  fields: z.array(EntityFieldSchema),
  relationships: z.array(EntityRelationshipSchema),
  confidence: z.number().min(0).max(1),
  signals: z.array(z.string()),
})

export type Entity = z.infer<typeof EntitySchema>

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const LayerSchema = z.enum(['data', 'api', 'service', 'external'])
export type Layer = z.infer<typeof LayerSchema>

// ---------------------------------------------------------------------------
// Layer Detection Result
// ---------------------------------------------------------------------------

export const LayerDetectionResultSchema = z.object({
  layer: LayerSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
})

export type LayerDetectionResult = z.infer<typeof LayerDetectionResultSchema>

// ---------------------------------------------------------------------------
// Service Type
// ---------------------------------------------------------------------------

export const ServiceTypeSchema = z.enum([
  'frontend',
  'api-server',
  'worker',
  'library',
  'unknown',
])
export type ServiceType = z.infer<typeof ServiceTypeSchema>

// ---------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------

export const ArchitectureSchema = z.enum(['monolith', 'microservices'])
export type Architecture = z.infer<typeof ArchitectureSchema>

// ---------------------------------------------------------------------------
// Service Info
// ---------------------------------------------------------------------------

export const ServiceInfoSchema = z.object({
  name: z.string(),
  rootPath: z.string(),
  type: ServiceTypeSchema,
  framework: z.string().optional(),
  fileCount: z.number(),
  layers: z.array(LayerDetectionResultSchema),
  files: z.array(z.string()),
})

export type ServiceInfo = z.infer<typeof ServiceInfoSchema>

// ---------------------------------------------------------------------------
// Service Dependency Info
// ---------------------------------------------------------------------------

export const ServiceDependencyDetailSchema = z.object({
  filePath: z.string(),
  importedFrom: z.string(),
  importedNames: z.array(z.string()),
})

export type ServiceDependencyDetail = z.infer<typeof ServiceDependencyDetailSchema>

export const ServiceDependencyInfoSchema = z.object({
  source: z.string(),
  target: z.string(),
  dependencies: z.array(ServiceDependencyDetailSchema),
  httpCalls: z.array(HttpCallSchema).optional(),
})

export type ServiceDependencyInfo = z.infer<typeof ServiceDependencyInfoSchema>
