import type {
  ColumnInfo,
  DatabaseType,
  RelationInfo,
  TableInfo,
} from '@truecourse/shared'

export interface EfCoreProjectFile {
  filePath: string
  content: string
  serviceName: string
  /** EF provider types detected for the containing service. */
  providerTypes?: DatabaseType[]
}

export interface EfCoreProjectSchema {
  dbType: DatabaseType | null
  serviceName: string
  contextName: string | null
  tables: TableInfo[]
  relations: RelationInfo[]
}

interface ParsedFile {
  input: EfCoreProjectFile
  masked: string
  namespace: string
  usings: string[]
  entities: EntityCandidate[]
  contexts: ContextCandidate[]
  configurations: ConfigurationCandidate[]
  providerHints: ProviderHint[]
}

interface EntityCandidate {
  name: string
  fullName: string
  namespace: string
  tableAttribute?: string
  annotated: boolean
  isAbstract: boolean
  baseTypes: string[]
  dbSets: DbSetCandidate[]
  toTables: ToTableCandidate[]
  appliedConfigurations: string[]
  applyAllConfigurations: boolean
  inlineProviderTypes: DatabaseType[]
  properties: PropertyCandidate[]
  file: ParsedFile
}

interface PropertyCandidate {
  name: string
  rawType: string
  attributes: string
  columnName?: string
  navigationType?: string
  collectionNavigationType?: string
  foreignKeyNavigation?: string
  isKey: boolean
  isNullable: boolean
  file: ParsedFile
}

interface ContextCandidate {
  name: string
  fullName: string
  isAbstract: boolean
  dbSets: DbSetCandidate[]
  toTables: ToTableCandidate[]
  baseTypes: string[]
  appliedConfigurations: string[]
  applyAllConfigurations: boolean
  inlineProviderTypes: DatabaseType[]
  file: ParsedFile
}

interface DbSetCandidate {
  entityType: string
  propertyName: string
}

interface ToTableCandidate {
  entityType: string
  tableName: string
  file: ParsedFile
}

interface ConfigurationCandidate {
  name: string
  fullName: string
  entityType: string
  toTables: ToTableCandidate[]
  file: ParsedFile
}

interface ProviderHint {
  contextType: string
  dbType: DatabaseType
  file: ParsedFile
}

interface EntityBinding {
  entity: EntityCandidate
  dbSetName?: string
  toTableName?: string
}

interface EntityIndex {
  byFullName: Map<string, EntityCandidate>
  bySimpleName: Map<string, EntityCandidate[]>
}

/**
 * Parse all EF Core source files belonging to one or more services.
 *
 * EF's model is repository-scoped evidence: the DbContext, entity classes, and
 * fluent configuration normally live in different files. Keeping those facts
 * separate until this reconciliation pass prevents empty DbSet stubs, duplicate
 * class-name tables, and relation endpoints that do not name emitted tables.
 */
export function parseEfCoreProject(files: EfCoreProjectFile[]): EfCoreProjectSchema[] {
  const parsedFiles = files.map(parseProjectFile)
  const filesByService = new Map<string, ParsedFile[]>()

  for (const file of parsedFiles) {
    const serviceFiles = filesByService.get(file.input.serviceName) ?? []
    serviceFiles.push(file)
    filesByService.set(file.input.serviceName, serviceFiles)
  }

  const schemas: EfCoreProjectSchema[] = []

  for (const [serviceName, serviceFiles] of filesByService) {
    const { entities, contexts } = reconcileClassDeclarations(serviceFiles)
    const configurations = serviceFiles.flatMap((file) => file.configurations)
    const providerHints = serviceFiles.flatMap((file) => file.providerHints)
    const index = buildEntityIndex(entities)
    const providerTypes = dedupe(
      serviceFiles.flatMap((file) => file.input.providerTypes ?? []),
    )
    const concreteContexts = contexts.filter((context) => !context.isAbstract)
    if (concreteContexts.length > 0) {
      for (const context of concreteContexts) {
        const schema = buildContextSchema(
          serviceName,
          context,
          concreteContexts.length,
          entities,
          index,
          providerTypes,
          contexts,
          configurations,
          providerHints,
        )
        if (schema.tables.length > 0) schemas.push(schema)
      }
    }

    // Preserve annotated entity-only schemas when a project has no context in
    // the scanned surface. When there is exactly one context, annotated types
    // are already included in that model. With several contexts, unclaimed
    // annotated types are deliberately left unassigned instead of guessing.
    if (concreteContexts.length === 0) {
      const annotated = entities.filter((entity) => entity.annotated)
      if (annotated.length > 0) {
        const explicitTypes = dedupe(
          serviceFiles
            .map((file) => detectProviderFromContent(file.input.content))
            .filter((type): type is DatabaseType => type !== undefined),
        )
        const dbType = chooseProvider(explicitTypes, providerTypes)
        const schema = buildStandaloneSchema(serviceName, dbType, annotated, index)
        if (schema.tables.length > 0) schemas.push(schema)
      }
    }
  }

  return schemas
}

/** Parse one EF Core source file. Kept as the registry's single-file seam. */
export function parseEfCoreSchema(content: string): {
  tables: TableInfo[]
  relations: RelationInfo[]
} {
  const schemas = parseEfCoreProject([
    {
      filePath: '<memory>',
      content,
      serviceName: '<memory>',
      providerTypes: [detectProviderFromContent(content)]
        .filter((type): type is DatabaseType => type !== undefined),
    },
  ])

  return {
    tables: schemas.flatMap((schema) => schema.tables),
    relations: schemas.flatMap((schema) => schema.relations),
  }
}

function parseProjectFile(input: EfCoreProjectFile): ParsedFile {
  const masked = maskCSharpTrivia(input.content)
  const file = {
    input,
    masked,
    namespace: extractNamespace(masked),
    usings: extractUsings(masked),
    entities: [],
    contexts: [],
    configurations: [],
    providerHints: [],
  } as ParsedFile

  file.providerHints = extractProviderHints(file)

  const classRegex = /\b(?:(?:public|internal|protected|private)\s+)?(?:(?:abstract|sealed|static|partial)\s+)*(?:class|record(?:\s+class)?)\s+([A-Za-z_]\w*)([^;{}]*)\{/g
  let match: RegExpExecArray | null

  while ((match = classRegex.exec(masked)) !== null) {
    const name = match[1]
    if (name === 'class' || name === 'struct') continue

    const openBrace = match.index + match[0].lastIndexOf('{')
    const closeBrace = findMatchingBrace(masked, openBrace)
    if (closeBrace === -1) continue

    const classNamespace = extractNamespace(masked.slice(0, match.index)) || file.namespace
    const fullName = classNamespace ? `${classNamespace}.${name}` : name
    const originalBody = input.content.slice(openBrace + 1, closeBrace)
    const maskedBody = masked.slice(openBrace + 1, closeBrace)
    const headerTail = match[2]
    const isAbstract = /\babstract\b/.test(match[0].slice(0, match[0].indexOf(name)))
    const baseTypes = extractBaseTypes(headerTail)
    const dbSets = extractDbSets(maskedBody)
    const toTables = extractToTables(originalBody, maskedBody, file)
    const appliedConfigurations = extractAppliedConfigurations(maskedBody)
    const applyAllConfigurations = /\bApplyConfigurationsFromAssembly\s*\(/.test(maskedBody)
    const inlineProvider = detectProviderFromMasked(maskedBody)
    const inlineProviderTypes = inlineProvider ? [inlineProvider] : []
    const configurationEntityType = extractConfigurationEntityType(baseTypes)
    const isDbContext = baseTypes.some((baseType) => {
      const simpleName = simpleTypeName(baseType)
      return simpleName === 'DbContext' || simpleName === 'IdentityDbContext'
    })

    if (configurationEntityType) {
      file.configurations.push({
        name,
        fullName,
        entityType: configurationEntityType,
        toTables: extractConfigurationToTables(originalBody, maskedBody, configurationEntityType, file),
        file,
      })
      classRegex.lastIndex = closeBrace + 1
      continue
    }

    if (isDbContext) {
      file.contexts.push({
        name,
        fullName,
        isAbstract,
        dbSets,
        toTables,
        baseTypes,
        appliedConfigurations,
        applyAllConfigurations,
        inlineProviderTypes,
        file,
      })
    } else {
      const attributes = attributesBefore(input.content, masked, match.index)
      const tableAttribute = extractStringAttribute(attributes, 'Table')
      const properties = extractProperties(originalBody, maskedBody, name, file)
      file.entities.push({
        name,
        fullName,
        namespace: classNamespace,
        tableAttribute,
        annotated: tableAttribute !== undefined
          || properties.some((property) => /\[\s*Key\s*\]/.test(property.attributes)),
        isAbstract,
        baseTypes,
        dbSets,
        toTables,
        appliedConfigurations,
        applyAllConfigurations,
        inlineProviderTypes,
        properties,
        file,
      })
    }

    classRegex.lastIndex = closeBrace + 1
  }

  return file
}

function reconcileClassDeclarations(
  files: ParsedFile[],
): { entities: EntityCandidate[]; contexts: ContextCandidate[] } {
  const entities = mergeEntityDeclarations(files.flatMap((file) => file.entities))
  const contexts = mergeContextDeclarations(files.flatMap((file) => file.contexts))

  // A partial declaration may omit the base list. Once any part proves the
  // type is a context, absorb DbSet/configuration facts from every other part.
  for (const context of contexts) {
    const partialIndex = entities.findIndex((entity) => entity.fullName === context.fullName)
    if (partialIndex === -1) continue
    mergeContextFacts(context, entities[partialIndex])
    entities.splice(partialIndex, 1)
  }

  // Resolve indirect context inheritance using the declarations available in
  // the service (AppContext : BaseContext : DbContext).
  let changed = true
  while (changed) {
    changed = false
    const declarations = [...contexts, ...entities]
    for (let i = entities.length - 1; i >= 0; i--) {
      const entity = entities[i]
      const derivesFromContext = entity.baseTypes.some((baseType) => {
        const base = resolveNamedCandidate(baseType, entity.file, declarations)
        return base !== undefined && contexts.some((context) => context.fullName === base.fullName)
      })
      if (!derivesFromContext) continue

      contexts.push({
        name: entity.name,
        fullName: entity.fullName,
        isAbstract: entity.isAbstract,
        dbSets: entity.dbSets,
        toTables: entity.toTables,
        baseTypes: entity.baseTypes,
        appliedConfigurations: entity.appliedConfigurations,
        applyAllConfigurations: entity.applyAllConfigurations,
        inlineProviderTypes: entity.inlineProviderTypes,
        file: entity.file,
      })
      entities.splice(i, 1)
      changed = true
    }
  }

  inheritContextFacts(contexts)
  return { entities, contexts }
}

function mergeEntityDeclarations(parts: EntityCandidate[]): EntityCandidate[] {
  const grouped = groupBy(parts, (part) => part.fullName)
  return [...grouped.values()].map((declarations) => {
    const first = declarations[0]
    return {
      ...first,
      tableAttribute: declarations.find((part) => part.tableAttribute)?.tableAttribute,
      annotated: declarations.some((part) => part.annotated),
      isAbstract: declarations.some((part) => part.isAbstract),
      baseTypes: dedupe(declarations.flatMap((part) => part.baseTypes)),
      dbSets: dedupeBy(
        declarations.flatMap((part) => part.dbSets),
        (dbSet) => `${dbSet.entityType}:${dbSet.propertyName}`,
      ),
      toTables: declarations.flatMap((part) => part.toTables),
      appliedConfigurations: dedupe(
        declarations.flatMap((part) => part.appliedConfigurations),
      ),
      applyAllConfigurations: declarations.some((part) => part.applyAllConfigurations),
      inlineProviderTypes: dedupe(
        declarations.flatMap((part) => part.inlineProviderTypes),
      ),
      properties: dedupeBy(
        declarations.flatMap((part) => part.properties),
        (property) => property.name,
      ),
    }
  })
}

function mergeContextDeclarations(parts: ContextCandidate[]): ContextCandidate[] {
  const grouped = groupBy(parts, (part) => part.fullName)
  return [...grouped.values()].map((declarations) => {
    const first = declarations[0]
    return {
      ...first,
      isAbstract: declarations.some((part) => part.isAbstract),
      dbSets: dedupeBy(
        declarations.flatMap((part) => part.dbSets),
        (dbSet) => `${dbSet.entityType}:${dbSet.propertyName}`,
      ),
      toTables: declarations.flatMap((part) => part.toTables),
      baseTypes: dedupe(declarations.flatMap((part) => part.baseTypes)),
      appliedConfigurations: dedupe(
        declarations.flatMap((part) => part.appliedConfigurations),
      ),
      applyAllConfigurations: declarations.some((part) => part.applyAllConfigurations),
      inlineProviderTypes: dedupe(
        declarations.flatMap((part) => part.inlineProviderTypes),
      ),
    }
  })
}

function mergeContextFacts(context: ContextCandidate, partial: EntityCandidate): void {
  context.dbSets = dedupeBy(
    [...context.dbSets, ...partial.dbSets],
    (dbSet) => `${dbSet.entityType}:${dbSet.propertyName}`,
  )
  context.toTables.push(...partial.toTables)
  context.baseTypes = dedupe([...context.baseTypes, ...partial.baseTypes])
  context.appliedConfigurations = dedupe([
    ...context.appliedConfigurations,
    ...partial.appliedConfigurations,
  ])
  context.applyAllConfigurations ||= partial.applyAllConfigurations
  context.inlineProviderTypes = dedupe([
    ...context.inlineProviderTypes,
    ...partial.inlineProviderTypes,
  ])
}

function inheritContextFacts(contexts: ContextCandidate[]): void {
  const applied = new Set<string>()
  const visiting = new Set<string>()

  const apply = (context: ContextCandidate): void => {
    if (applied.has(context.fullName) || visiting.has(context.fullName)) return
    visiting.add(context.fullName)

    for (const baseType of context.baseTypes) {
      const baseContext = resolveNamedCandidate(baseType, context.file, contexts)
      if (!baseContext || baseContext.fullName === context.fullName) continue
      apply(baseContext)

      const dbSets = new Map<string, DbSetCandidate>()
      for (const dbSet of [...baseContext.dbSets, ...context.dbSets]) {
        dbSets.set(normalizeTypeReference(dbSet.entityType), dbSet)
      }
      context.dbSets = [...dbSets.values()]
      context.toTables = [...baseContext.toTables, ...context.toTables]
      context.appliedConfigurations = dedupe([
        ...baseContext.appliedConfigurations,
        ...context.appliedConfigurations,
      ])
      context.applyAllConfigurations ||= baseContext.applyAllConfigurations
      context.inlineProviderTypes = dedupe([
        ...baseContext.inlineProviderTypes,
        ...context.inlineProviderTypes,
      ])
    }

    visiting.delete(context.fullName)
    applied.add(context.fullName)
  }

  for (const context of contexts) apply(context)
}

function buildContextSchema(
  serviceName: string,
  context: ContextCandidate,
  contextCount: number,
  serviceEntities: EntityCandidate[],
  index: EntityIndex,
  serviceProviderTypes: DatabaseType[],
  serviceContexts: ContextCandidate[],
  configurations: ConfigurationCandidate[],
  providerHints: ProviderHint[],
): EfCoreProjectSchema {
  const bindings = new Map<string, EntityBinding>()
  const unresolvedDbSets: DbSetCandidate[] = []

  for (const dbSet of context.dbSets) {
    const entity = resolveEntityReference(dbSet.entityType, context.file, index)
    if (!entity) {
      unresolvedDbSets.push(dbSet)
      continue
    }
    const binding = bindings.get(entity.fullName) ?? { entity }
    binding.dbSetName ??= dbSet.propertyName
    bindings.set(entity.fullName, binding)
  }

  const activeConfigurations = context.applyAllConfigurations
    ? configurations
    : context.appliedConfigurations
      .map((reference) => resolveNamedCandidate(reference, context.file, configurations))
      .filter((candidate): candidate is ConfigurationCandidate => candidate !== undefined)
  const tableMappings = [
    ...context.toTables,
    ...activeConfigurations.flatMap((configuration) => configuration.toTables),
  ]

  for (const mapping of tableMappings) {
    const entity = resolveEntityReference(mapping.entityType, mapping.file, index)
    if (!entity) continue
    const binding = bindings.get(entity.fullName) ?? { entity }
    binding.toTableName = mapping.tableName
    bindings.set(entity.fullName, binding)
  }

  // A single context owns the service's provable annotated entities. With
  // multiple contexts we require DbSet/ToTable/navigation evidence so simple
  // class-name collisions are never merged across model scopes.
  if (contextCount === 1) {
    for (const entity of serviceEntities) {
      if (!entity.annotated) continue
      bindings.set(entity.fullName, bindings.get(entity.fullName) ?? { entity })
    }
  }

  addNavigationClosure(bindings, index)
  const { tables, relations } = emitBindings(bindings, index)

  for (const dbSet of unresolvedDbSets) {
    tables.push({
      name: dbSet.propertyName,
      columns: [],
      aliases: dedupe([
        normalizeTypeReference(dbSet.entityType),
        snakeCase(dbSet.entityType.split('.').pop() ?? dbSet.entityType),
        snakeCase(dbSet.propertyName),
      ]).filter((alias) => alias && alias !== dbSet.propertyName),
    })
  }

  const configuredProviders = providerHints
    .filter((hint) =>
      resolveNamedCandidate(hint.contextType, hint.file, serviceContexts)?.fullName
        === context.fullName
    )
    .map((hint) => hint.dbType)
  const explicitProviders = dedupe([
    ...context.inlineProviderTypes,
    ...configuredProviders,
  ])
  const dbType = chooseProvider(explicitProviders, serviceProviderTypes)

  return {
    dbType,
    serviceName,
    contextName: context.fullName,
    tables,
    relations,
  }
}

function buildStandaloneSchema(
  serviceName: string,
  dbType: DatabaseType | null,
  entities: EntityCandidate[],
  index: EntityIndex,
): EfCoreProjectSchema {
  const bindings = new Map<string, EntityBinding>(
    entities.map((entity) => [entity.fullName, { entity }]),
  )
  addNavigationClosure(bindings, index)
  const { tables, relations } = emitBindings(bindings, index)

  return { dbType, serviceName, contextName: null, tables, relations }
}

function emitBindings(
  bindings: Map<string, EntityBinding>,
  index: EntityIndex,
): { tables: TableInfo[]; relations: RelationInfo[] } {
  const canonicalNames = new Map<string, string>()
  for (const [identity, binding] of bindings) {
    canonicalNames.set(identity, canonicalTableName(binding))
  }

  const tables: TableInfo[] = []
  const relations: RelationInfo[] = []
  for (const binding of bindings.values()) {
    const built = buildEntityTable(
      binding,
      canonicalNames.get(binding.entity.fullName)!,
      canonicalNames,
      index,
    )
    tables.push(built.table)
    relations.push(...built.relations)
  }

  return { tables, relations }
}

function addNavigationClosure(
  bindings: Map<string, EntityBinding>,
  index: EntityIndex,
): void {
  let changed = true
  while (changed) {
    changed = false
    for (const binding of [...bindings.values()]) {
      for (const property of binding.entity.properties) {
        const targetType = property.navigationType ?? property.collectionNavigationType
        if (!targetType) continue
        const target = resolveEntityReference(targetType, property.file, index)
        if (!target || bindings.has(target.fullName)) continue
        bindings.set(target.fullName, { entity: target })
        changed = true
      }
    }
  }
}

function buildEntityTable(
  binding: EntityBinding,
  tableName: string,
  canonicalNames: Map<string, string>,
  index: EntityIndex,
): { table: TableInfo; relations: RelationInfo[] } {
  const { entity } = binding
  const columns: ColumnInfo[] = []
  const relations: RelationInfo[] = []
  const navigations = new Map(
    entity.properties
      .filter((property) => property.navigationType)
      .map((property) => [property.name, property]),
  )
  let primaryKey: string | undefined

  for (const property of entity.properties) {
    if (property.navigationType || property.collectionNavigationType) continue

    const columnName = property.columnName ?? snakeCase(property.name)
    const isKey = property.isKey || property.name === 'Id' || property.name === `${entity.name}Id`
    const conventionNavigation =
      property.name.endsWith('Id') && property.name !== 'Id' && property.name !== `${entity.name}Id`
        ? property.name.slice(0, -2)
        : undefined
    const navigationName = property.foreignKeyNavigation ?? conventionNavigation
    const navigation = navigationName
      ? navigations.get(navigationName)
      : entity.properties.find((candidate) =>
        candidate.navigationType && candidate.foreignKeyNavigation === property.name
      )
    const targetEntity = navigation?.navigationType
      ? resolveEntityReference(navigation.navigationType, navigation.file, index)
      : undefined
    const targetTable = targetEntity ? canonicalNames.get(targetEntity.fullName) : undefined
    const isForeignKey = targetTable !== undefined || property.foreignKeyNavigation !== undefined

    columns.push({
      name: columnName,
      type: normalizePropertyType(property.rawType),
      ...(property.isNullable ? { isNullable: true } : {}),
      ...(isKey && !primaryKey ? { isPrimaryKey: true } : {}),
      ...(isForeignKey ? { isForeignKey: true } : {}),
      ...(targetTable ? { referencesTable: targetTable } : {}),
    })

    if (isKey && !primaryKey) primaryKey = columnName
    if (targetTable) {
      relations.push({
        sourceTable: tableName,
        targetTable,
        relationType: 'one-to-many',
        foreignKeyColumn: columnName,
      })
    }
  }

  const aliases = dedupe([
    entity.name,
    entity.fullName,
    snakeCase(entity.name),
    binding.dbSetName,
    binding.dbSetName ? snakeCase(binding.dbSetName) : undefined,
    entity.tableAttribute,
  ].filter((value): value is string => value !== undefined && value.length > 0))
    .filter((alias) => alias !== tableName)

  return {
    table: {
      name: tableName,
      columns,
      ...(primaryKey ? { primaryKey } : {}),
      ...(aliases.length > 0 ? { aliases } : {}),
    },
    relations,
  }
}

function canonicalTableName(binding: EntityBinding): string {
  return binding.toTableName
    ?? binding.entity.tableAttribute
    ?? binding.dbSetName
    ?? snakeCase(binding.entity.name)
}

function buildEntityIndex(entities: EntityCandidate[]): EntityIndex {
  const byFullName = new Map<string, EntityCandidate>()
  const bySimpleName = new Map<string, EntityCandidate[]>()

  for (const entity of entities) {
    byFullName.set(entity.fullName, entity)
    const sameName = bySimpleName.get(entity.name) ?? []
    sameName.push(entity)
    bySimpleName.set(entity.name, sameName)
  }

  return { byFullName, bySimpleName }
}

function resolveNamedCandidate<T extends { name: string; fullName: string; file: ParsedFile }>(
  rawType: string,
  sourceFile: ParsedFile,
  candidates: T[],
): T | undefined {
  const typeName = normalizeNamedTypeReference(rawType)
  const simpleName = typeName.split('.').pop() ?? typeName
  const byFullName = new Map(candidates.map((candidate) => [candidate.fullName, candidate]))

  const exact = byFullName.get(typeName)
  if (exact) return exact

  if (typeName.includes('.') && sourceFile.namespace) {
    const relative = byFullName.get(`${sourceFile.namespace}.${typeName}`)
    if (relative) return relative
  }

  if (sourceFile.namespace) {
    const sameNamespace = byFullName.get(`${sourceFile.namespace}.${simpleName}`)
    if (sameNamespace) return sameNamespace
  }

  const imported = sourceFile.usings
    .map((namespace) => byFullName.get(`${namespace}.${simpleName}`))
    .filter((candidate): candidate is T => candidate !== undefined)
  if (imported.length === 1) return imported[0]

  const sameName = candidates.filter((candidate) => candidate.name === simpleName)
  return sameName.length === 1 ? sameName[0] : undefined
}

function resolveEntityReference(
  rawType: string,
  sourceFile: ParsedFile,
  index: EntityIndex,
): EntityCandidate | undefined {
  const typeName = normalizeTypeReference(rawType)
  const simpleName = typeName.split('.').pop() ?? typeName

  const exact = index.byFullName.get(typeName)
  if (exact) return exact

  if (typeName.includes('.') && sourceFile.namespace) {
    const relative = index.byFullName.get(`${sourceFile.namespace}.${typeName}`)
    if (relative) return relative
  }

  if (sourceFile.namespace) {
    const sameNamespace = index.byFullName.get(`${sourceFile.namespace}.${simpleName}`)
    if (sameNamespace) return sameNamespace
  }

  const imported = sourceFile.usings
    .map((namespace) => index.byFullName.get(`${namespace}.${simpleName}`))
    .filter((candidate): candidate is EntityCandidate => candidate !== undefined)
  if (imported.length === 1) return imported[0]

  const candidates = index.bySimpleName.get(simpleName) ?? []
  return candidates.length === 1 ? candidates[0] : undefined
}

function extractDbSets(maskedBody: string): DbSetCandidate[] {
  const dbSets: DbSetCandidate[] = []
  const regex = /\bpublic\s+(?:(?:virtual|required|new)\s+)*(?:Microsoft\.EntityFrameworkCore\.)?DbSet\s*<\s*([^>]+?)\s*>\s*\??\s+([A-Za-z_]\w*)\s*(?=\{|=>)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(maskedBody)) !== null) {
    dbSets.push({ entityType: match[1].trim(), propertyName: match[2] })
  }
  return dbSets
}

function extractToTables(
  originalBody: string,
  maskedBody: string,
  file: ParsedFile,
): ToTableCandidate[] {
  const mappings: ToTableCandidate[] = []
  const entityRegex = /\bEntity\s*<\s*([^>]+?)\s*>\s*\(/g
  const entityMatches = [...maskedBody.matchAll(entityRegex)]

  for (let i = 0; i < entityMatches.length; i++) {
    const match = entityMatches[i]
    const segmentStart = match.index! + match[0].length
    const segmentEnd = entityMatches[i + 1]?.index ?? maskedBody.length
    const segment = maskedBody.slice(segmentStart, segmentEnd)
    const toTable = /\bToTable\s*\(/.exec(segment)
    if (!toTable) continue

    const callStart = segmentStart + toTable.index
    const openParen = maskedBody.indexOf('(', callStart)
    const closeParen = findMatchingDelimiter(maskedBody, openParen, '(', ')')
    if (closeParen === -1 || closeParen >= segmentEnd) continue

    const originalCall = originalBody.slice(callStart, closeParen + 1)
    const tableMatch = /\bToTable\s*\(\s*"((?:\\.|[^"\\])*)"/.exec(originalCall)
    if (!tableMatch) continue
    mappings.push({
      entityType: match[1].trim(),
      tableName: tableMatch[1].replace(/\\"/g, '"'),
      file,
    })
  }

  return mappings
}

function extractConfigurationToTables(
  originalBody: string,
  maskedBody: string,
  entityType: string,
  file: ParsedFile,
): ToTableCandidate[] {
  const mappings: ToTableCandidate[] = []
  const regex = /\bToTable\s*\(/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(maskedBody)) !== null) {
    const openParen = maskedBody.indexOf('(', match.index)
    const closeParen = findMatchingDelimiter(maskedBody, openParen, '(', ')')
    if (closeParen === -1) continue
    const originalCall = originalBody.slice(match.index, closeParen + 1)
    const tableMatch = /\bToTable\s*\(\s*"((?:\\.|[^"\\])*)"/.exec(originalCall)
    if (!tableMatch) continue
    mappings.push({
      entityType,
      tableName: tableMatch[1].replace(/\\"/g, '"'),
      file,
    })
    regex.lastIndex = closeParen + 1
  }

  return mappings
}

function extractAppliedConfigurations(maskedBody: string): string[] {
  return [
    ...maskedBody.matchAll(
      /\bApplyConfiguration\s*\(\s*new\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g,
    ),
  ].map((match) => match[1])
}

function extractProviderHints(file: ParsedFile): ProviderHint[] {
  const hints: ProviderHint[] = []
  const regex = /\bAddDbContext(?:Pool|Factory)?\s*<\s*([^>]+?)\s*>\s*\(/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(file.masked)) !== null) {
    const openParen = file.masked.indexOf('(', match.index)
    const closeParen = findMatchingDelimiter(file.masked, openParen, '(', ')')
    if (closeParen === -1) continue
    const dbType = detectProviderFromMasked(file.masked.slice(openParen, closeParen + 1))
    if (dbType) hints.push({ contextType: match[1].trim(), dbType, file })
    regex.lastIndex = closeParen + 1
  }

  return hints
}

function extractBaseTypes(headerTail: string): string[] {
  const colon = headerTail.indexOf(':')
  if (colon === -1) return []
  const clause = headerTail.slice(colon + 1).split(/\bwhere\b/, 1)[0]
  return splitTopLevel(clause, ',').map((part) => part.trim()).filter(Boolean)
}

function extractConfigurationEntityType(baseTypes: string[]): string | undefined {
  for (const baseType of baseTypes) {
    const match = /(?:^|\.)IEntityTypeConfiguration\s*<\s*(.+)\s*>$/.exec(baseType)
    if (match) return match[1].trim()
  }
  return undefined
}

function extractProperties(
  originalBody: string,
  maskedBody: string,
  className: string,
  file: ParsedFile,
): PropertyCandidate[] {
  const properties: PropertyCandidate[] = []
  const regex = /((?:\[[^\]]*\]\s*)*)\bpublic\s+(?:(?:virtual|required|new|override)\s+)*([\w.?:<>,\[\]]+)\s+([A-Za-z_]\w*)\s*\{\s*(?:get|init)\s*;/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(maskedBody)) !== null) {
    const rawType = match[2]
    const name = match[3]
    const attributeLength = match[1].length
    const attributes = originalBody.slice(match.index, match.index + attributeLength)
    if (/\[\s*NotMapped\b/.test(attributes)) continue

    const collectionNavigationType = extractCollectionElement(rawType)
    const normalizedType = normalizePropertyType(rawType)
    const navigationType = !collectionNavigationType && !isKnownValueType(normalizedType)
      ? normalizedType
      : undefined
    const columnName = extractStringAttribute(attributes, 'Column')
    const foreignKeyNavigation = extractForeignKeyNavigation(attributes)
    const isKey = /\[\s*Key\s*\]/.test(attributes)
      || name === 'Id'
      || name === `${className}Id`

    properties.push({
      name,
      rawType,
      attributes,
      columnName,
      navigationType,
      collectionNavigationType,
      foreignKeyNavigation,
      isKey,
      isNullable: rawType.trim().endsWith('?'),
      file,
    })
  }

  return properties
}

function attributesBefore(
  content: string,
  maskedContent: string,
  declarationStart: number,
): string {
  let cursor = skipWhitespaceBackward(maskedContent, declarationStart)
  let attributeStart = declarationStart
  let foundAttribute = false

  while (cursor > 0 && maskedContent[cursor - 1] === ']') {
    const openBracket = findMatchingOpeningDelimiter(maskedContent, cursor - 1, '[', ']')
    if (openBracket === -1) break
    attributeStart = openBracket
    foundAttribute = true
    cursor = skipWhitespaceBackward(maskedContent, openBracket)
  }

  return foundAttribute ? content.slice(attributeStart, declarationStart) : ''
}

function extractStringAttribute(attributes: string, attributeName: string): string | undefined {
  const regex = new RegExp(`\\[\\s*(?:[\\w.]+\\.)?${attributeName}(?:Attribute)?\\s*\\(\\s*"([^"]+)"`)
  return regex.exec(attributes)?.[1]
}

function extractForeignKeyNavigation(attributes: string): string | undefined {
  const stringForm = /\[\s*(?:[\w.]+\.)?ForeignKey(?:Attribute)?\s*\(\s*"([^"]+)"/.exec(attributes)
  if (stringForm) return stringForm[1]
  return /\[\s*(?:[\w.]+\.)?ForeignKey(?:Attribute)?\s*\(\s*nameof\s*\(\s*([A-Za-z_]\w*)\s*\)/.exec(attributes)?.[1]
}

function extractCollectionElement(rawType: string): string | undefined {
  const normalized = rawType.replace(/\?$/, '').trim()
  return /^(?:(?:System\.Collections\.Generic\.)?(?:ICollection|IEnumerable|IReadOnlyCollection|List|HashSet|Collection))\s*<\s*([^>]+)\s*>$/.exec(normalized)?.[1]?.trim()
}

function extractNamespace(maskedContent: string): string {
  const matches = [...maskedContent.matchAll(/\bnamespace\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*[;{]/g)]
  return matches.at(-1)?.[1] ?? ''
}

function extractUsings(maskedContent: string): string[] {
  return [...maskedContent.matchAll(/(?:^|\n)\s*(?:global\s+)?using\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/g)]
    .map((match) => match[1])
}

function detectProviderFromContent(content: string): DatabaseType | undefined {
  return detectProviderFromMasked(maskCSharpTrivia(content))
}

function detectProviderFromMasked(masked: string): DatabaseType | undefined {
  if (/\bUseSqlServer\s*\(/.test(masked)) return 'sqlserver'
  if (/\bUseSqlite\s*\(/.test(masked)) return 'sqlite'
  if (/\bUseMySql\s*\(/.test(masked)) return 'mysql'
  if (/\bUseNpgsql\s*\(/.test(masked)) return 'postgres'
  return undefined
}

function chooseProvider(
  explicitTypes: DatabaseType[],
  serviceTypes: DatabaseType[],
): DatabaseType | null {
  if (explicitTypes.length === 1) return explicitTypes[0]
  if (explicitTypes.length > 1) return null
  if (serviceTypes.length === 1) return serviceTypes[0]
  return null
}

function simpleTypeName(rawType: string): string {
  const normalized = normalizeNamedTypeReference(rawType)
  return normalized.split('.').pop() ?? normalized
}

function normalizeNamedTypeReference(rawType: string): string {
  const normalized = normalizeTypeReference(rawType)
  let result = ''
  let genericDepth = 0
  for (const char of normalized) {
    if (char === '<') {
      genericDepth++
      continue
    }
    if (char === '>') {
      genericDepth--
      continue
    }
    if (genericDepth === 0) result += char
  }
  return result
}

function splitTopLevel(content: string, separator: string): string[] {
  const parts: string[] = []
  let start = 0
  let genericDepth = 0
  let parenDepth = 0
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '<') genericDepth++
    else if (content[i] === '>') genericDepth--
    else if (content[i] === '(') parenDepth++
    else if (content[i] === ')') parenDepth--
    else if (content[i] === separator && genericDepth === 0 && parenDepth === 0) {
      parts.push(content.slice(start, i))
      start = i + 1
    }
  }
  parts.push(content.slice(start))
  return parts
}

function normalizeTypeReference(rawType: string): string {
  return rawType
    .replace(/^global::/, '')
    .replace(/\?$/, '')
    .replace(/\s+/g, '')
}

function normalizePropertyType(rawType: string): string {
  const normalized = normalizeTypeReference(rawType)
  const nullable = /^Nullable<(.+)>$/.exec(normalized)
  return nullable?.[1] ?? normalized
}

function isKnownValueType(typeName: string): boolean {
  if (typeName.endsWith('[]')) return true
  const simpleName = typeName.split('.').pop() ?? typeName
  return KNOWN_VALUE_TYPES.has(simpleName)
}

const KNOWN_VALUE_TYPES = new Set([
  'bool', 'byte', 'sbyte', 'char', 'decimal', 'double', 'float',
  'int', 'uint', 'nint', 'nuint', 'long', 'ulong', 'short', 'ushort',
  'object', 'string',
  'Guid', 'DateTime', 'DateTimeOffset', 'DateOnly', 'TimeOnly', 'TimeSpan',
  'String', 'Boolean', 'Byte', 'SByte', 'Char', 'Int16', 'Int32', 'Int64',
  'UInt16', 'UInt32', 'UInt64', 'Decimal', 'Double', 'Single',
])

/**
 * Replace comments, strings, and character literals with spaces while keeping
 * newlines and string length stable. Regex-based declaration extraction can
 * then operate on code tokens without treating prose as a class/record.
 */
function maskCSharpTrivia(content: string): string {
  const chars = content.split('')
  const blank = (index: number) => {
    if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' '
  }
  const hasQuoteRun = (index: number, length: number) => {
    for (let offset = 0; offset < length; offset++) {
      if (chars[index + offset] !== '"') return false
    }
    return true
  }

  let i = 0
  while (i < chars.length) {
    if (chars[i] === '/' && chars[i + 1] === '/') {
      blank(i++)
      blank(i++)
      while (i < chars.length && chars[i] !== '\n') blank(i++)
      continue
    }
    if (chars[i] === '/' && chars[i + 1] === '*') {
      blank(i++)
      blank(i++)
      while (i < chars.length) {
        if (chars[i] === '*' && chars[i + 1] === '/') {
          blank(i++)
          blank(i++)
          break
        }
        blank(i++)
      }
      continue
    }
    if (chars[i] === '"') {
      let quoteRun = 1
      while (chars[i + quoteRun] === '"') quoteRun++
      const rawQuoteCount = quoteRun >= 3 ? quoteRun : 1
      const verbatim = (i > 0 && chars[i - 1] === '@')
        || (i > 1 && chars[i - 1] === '$' && chars[i - 2] === '@')
      for (let n = 0; n < rawQuoteCount; n++) blank(i++)
      while (i < chars.length) {
        if (rawQuoteCount >= 3 && hasQuoteRun(i, rawQuoteCount)) {
          for (let n = 0; n < rawQuoteCount; n++) blank(i++)
          break
        }
        if (rawQuoteCount === 1 && chars[i] === '"') {
          if (verbatim && chars[i + 1] === '"') {
            blank(i++)
            blank(i++)
            continue
          }
          blank(i++)
          break
        }
        if (!verbatim && rawQuoteCount === 1 && chars[i] === '\\') {
          blank(i++)
          if (i < chars.length) blank(i++)
          continue
        }
        blank(i++)
      }
      continue
    }
    if (chars[i] === "'") {
      blank(i++)
      while (i < chars.length) {
        if (chars[i] === '\\') {
          blank(i++)
          if (i < chars.length) blank(i++)
          continue
        }
        const done = chars[i] === "'"
        blank(i++)
        if (done) break
      }
      continue
    }
    i++
  }

  return chars.join('')
}

function findMatchingBrace(content: string, openBrace: number): number {
  return findMatchingDelimiter(content, openBrace, '{', '}')
}

function findMatchingDelimiter(
  content: string,
  openIndex: number,
  open: string,
  close: string,
): number {
  if (openIndex < 0 || content[openIndex] !== open) return -1
  let depth = 0
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === open) depth++
    else if (content[i] === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function findMatchingOpeningDelimiter(
  content: string,
  closeIndex: number,
  open: string,
  close: string,
): number {
  if (closeIndex < 0 || content[closeIndex] !== close) return -1
  let depth = 0
  for (let i = closeIndex; i >= 0; i--) {
    if (content[i] === close) depth++
    else if (content[i] === open) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function skipWhitespaceBackward(content: string, end: number): number {
  let cursor = end
  while (cursor > 0 && /\s/.test(content[cursor - 1])) cursor--
  return cursor
}

function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function dedupeBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const identity = key(value)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const identity = key(value)
    const group = groups.get(identity) ?? []
    group.push(value)
    groups.set(identity, group)
  }
  return groups
}
