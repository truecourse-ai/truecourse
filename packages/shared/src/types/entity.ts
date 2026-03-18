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

// ---------------------------------------------------------------------------
// Layer Detail (per-service layer with file paths)
// ---------------------------------------------------------------------------

export const LayerDetailSchema = z.object({
  serviceName: z.string(),
  layer: LayerSchema,
  fileCount: z.number(),
  filePaths: z.array(z.string()),
  confidence: z.number(),
  evidence: z.array(z.string()),
})

export type LayerDetail = z.infer<typeof LayerDetailSchema>

// ---------------------------------------------------------------------------
// Layer Dependency (cross-layer dependency with violation detection)
// ---------------------------------------------------------------------------

export const LayerDependencyInfoSchema = z.object({
  sourceServiceName: z.string(),
  sourceLayer: LayerSchema,
  targetServiceName: z.string(),
  targetLayer: LayerSchema,
  dependencyCount: z.number(),
  isViolation: z.boolean(),
  violationReason: z.string().optional(),
})

export type LayerDependencyInfo = z.infer<typeof LayerDependencyInfoSchema>

// ---------------------------------------------------------------------------
// Violation Diff (Phase 5: Git Pending Changes)
// ---------------------------------------------------------------------------

export type ViolationDiffStatus = 'new' | 'resolved' | 'unchanged'

export type ViolationDiffItem = {
  sourceServiceName: string
  sourceLayer: string
  targetServiceName: string
  targetLayer: string
  violationReason: string
  status: ViolationDiffStatus
  dependencyCount: number
}

export type ModuleViolationDiffItem = {
  ruleKey: string
  title: string
  description: string
  severity: string
  serviceName: string
  moduleName?: string
  methodName?: string
  filePath: string
  status: ViolationDiffStatus
}

export type DiffCheckResult = {
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>
  resolvedViolationIds: string[]
  newViolations: DiffViolationItem[]
  summary: {
    newCount: number
    resolvedCount: number
  }
  affectedNodeIds: {
    services: string[]
    layers: string[]
    modules: string[]   // "serviceName::moduleName"
    methods: string[]   // "serviceName::moduleName::methodName"
  }
}

export type DiffViolationItem = {
  type: string
  title: string
  content: string
  severity: string
  targetServiceName: string | null
  targetModuleName: string | null
  targetMethodName: string | null
  fixPrompt: string | null
}
