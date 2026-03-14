/**
 * Entity extraction for data layer files
 * Detects ORM entities/models and extracts schema information
 */

import type { FileAnalysis, Entity, EntityField, EntityRelationship } from '@truecourse/shared'
import { dataLayerPatterns } from '../patterns/layer-patterns.js'
import { matchesPattern } from '../patterns/index.js'
import Parser from 'tree-sitter'
import TypeScript from 'tree-sitter-typescript'

/**
 * Check if a file likely contains entities based on ORM import patterns
 */
export function shouldExtractEntities(analysis: FileAnalysis): boolean {
  // Check for ORM imports
  const allOrms = dataLayerPatterns.orms

  for (const imp of analysis.imports) {
    if (allOrms.some(orm => matchesPattern(imp.source, orm))) {
      return true
    }
  }

  // Check file naming patterns (case-insensitive for directory names)
  const filePath = analysis.filePath.toLowerCase()
  const entityFilePatterns = [
    'models',
    'entities',
    'schemas',
    'domain',
    'database',
    'model.',
    'entity.',
    'schema.',
  ]

  return entityFilePatterns.some(pattern => filePath.includes(pattern))
}

/**
 * Extract entities from a file's source code
 */
export function extractEntities(
  sourceCode: string,
  filePath: string,
  language: 'typescript' | 'javascript',
  serviceName: string = 'default'
): Entity[] {
  // Both JS and TS use the TypeScript entity detector
  const detector = new TypeScriptEntityDetector()

  if (!detector.shouldScanFile(filePath)) {
    return []
  }

  return detector.detectEntities(sourceCode, filePath, serviceName)
}

/**
 * Map TypeScript/ORM type to simplified type
 */
function mapToSimpleType(type: string): string {
  const lowerType = type.toLowerCase()

  if (lowerType.includes('string') || lowerType.includes('varchar') || lowerType.includes('text')) {
    return 'string'
  }
  if (
    lowerType.includes('int') ||
    lowerType.includes('number') ||
    lowerType.includes('float') ||
    lowerType.includes('double') ||
    lowerType.includes('decimal')
  ) {
    return 'int'
  }
  if (lowerType.includes('bool')) {
    return 'boolean'
  }
  if (lowerType.includes('date') || lowerType.includes('time')) {
    return lowerType.includes('timestamp') ? 'timestamp' : 'date'
  }
  if (lowerType.includes('json')) {
    return 'json'
  }
  if (lowerType.includes('uuid')) {
    return 'uuid'
  }

  return 'string'
}

class TypeScriptEntityDetector {
  private parser: Parser

  constructor() {
    this.parser = new Parser()
    this.parser.setLanguage(TypeScript.typescript)
  }

  shouldScanFile(filePath: string): boolean {
    if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) {
      return false
    }
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath)) {
      return false
    }

    const entityDirs = ['models', 'entities', 'data', 'domain', 'schemas', 'database']
    const hasEntityDir = entityDirs.some((dir) => filePath.includes(`/${dir}/`))

    const entityPatterns = ['.model.', '.entity.', '.schema.']
    const hasEntityPattern = entityPatterns.some((pattern) => filePath.includes(pattern))

    return hasEntityDir || hasEntityPattern
  }

  detectEntities(sourceCode: string, filePath: string, service: string): Entity[] {
    const tree = this.parser.parse(sourceCode)
    const entities: Entity[] = []

    // Find all class declarations
    const classNodes = this.findClassDeclarations(tree.rootNode)

    for (const classNode of classNodes) {
      const entity = this.detectEntityFromClass(classNode, sourceCode, filePath, service)
      if (entity) {
        entities.push(entity)
      }
    }

    // Also find interface declarations (for projects using plain interfaces as models)
    const interfaceNodes = this.findInterfaceDeclarations(tree.rootNode)

    for (const interfaceNode of interfaceNodes) {
      const entity = this.detectEntityFromInterface(interfaceNode, sourceCode, filePath, service)
      if (entity) {
        entities.push(entity)
      }
    }

    return entities
  }

  private findClassDeclarations(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const classes: Parser.SyntaxNode[] = []

    const traverse = (n: Parser.SyntaxNode) => {
      if (n.type === 'export_statement') {
        const declaration = n.childForFieldName('declaration')
        if (declaration && declaration.type === 'class_declaration') {
          classes.push(n)
          return
        }
      } else if (n.type === 'class_declaration') {
        if (n.parent?.type !== 'export_statement') {
          classes.push(n)
        }
      }
      n.children.forEach(traverse)
    }

    traverse(node)
    return classes
  }

  private detectEntityFromClass(
    node: Parser.SyntaxNode,
    sourceCode: string,
    filePath: string,
    service: string
  ): Entity | null {
    let classNode = node
    if (node.type === 'export_statement') {
      const declaration = node.childForFieldName('declaration')
      if (!declaration || declaration.type !== 'class_declaration') return null
      classNode = declaration
    }

    const nameNode = classNode.childForFieldName('name')
    if (!nameNode) return null

    const className = sourceCode.substring(nameNode.startIndex, nameNode.endIndex)

    const signals: string[] = []
    let confidence = 0

    // Check for ORM decorators
    const ormDecorators: Record<string, { decorators: string[]; signal: string; score: number }> = {
      typeorm: { decorators: ['Entity'], signal: '@Entity decorator', score: 0.5 },
      'sequelize-typescript': { decorators: ['Table'], signal: '@Table decorator', score: 0.5 },
    }

    for (const [, pattern] of Object.entries(ormDecorators)) {
      const hasDecorator = pattern.decorators.some((dec) =>
        this.hasDecorator(node, sourceCode, dec)
      )
      if (hasDecorator) {
        signals.push(pattern.signal)
        confidence += pattern.score
      }
    }

    // Check base class patterns
    const extendsClass = this.getExtendsClass(classNode, sourceCode)
    if (extendsClass && /^(Base)?Model|Entity|Table$/i.test(extendsClass)) {
      if (!signals.some(s => s.includes('extends'))) {
        signals.push(`extends ${extendsClass}`)
        confidence += 0.4
      }
    }

    if (this.shouldScanFile(filePath)) {
      signals.push('in entity directory or named as entity file')
      confidence += 0.2
    }

    if (confidence < 0.4) {
      return null
    }

    const fields = this.extractFields(classNode, sourceCode)
    const relationships = this.extractRelationships(classNode, sourceCode)
    const framework = this.detectFrameworkFromSource(sourceCode)

    return {
      name: className,
      service,
      framework: framework || 'unknown',
      fields,
      relationships,
      confidence,
      signals,
    }
  }

  private hasDecorator(classNode: Parser.SyntaxNode, sourceCode: string, decoratorName: string): boolean {
    const decorators = classNode.children.filter((child) => child.type === 'decorator')

    return decorators.some((decorator) => {
      const text = sourceCode.substring(decorator.startIndex, decorator.endIndex)
      return text.includes(`@${decoratorName}`)
    })
  }

  private getExtendsClass(classNode: Parser.SyntaxNode, sourceCode: string): string | null {
    const heritageClause = classNode.children.find((child) => child.type === 'class_heritage')
    if (!heritageClause) return null

    const extendsClause = heritageClause.children.find((child) => child.type === 'extends_clause')
    if (!extendsClause) return null

    const typeNode = extendsClause.children.find((child) => child.type === 'type_identifier' || child.type === 'identifier')
    if (!typeNode) return null

    return sourceCode.substring(typeNode.startIndex, typeNode.endIndex)
  }

  private extractFields(classNode: Parser.SyntaxNode, sourceCode: string): EntityField[] {
    const fields: EntityField[] = []
    const bodyNode = classNode.childForFieldName('body')
    if (!bodyNode) return fields

    for (const member of bodyNode.children) {
      if (member.type === 'property_declaration' || member.type === 'public_field_definition') {
        const field = this.extractField(member, sourceCode)
        if (field) {
          fields.push(field)
        }
      }
    }

    return fields
  }

  private extractField(fieldNode: Parser.SyntaxNode, sourceCode: string): EntityField | null {
    const nameNode = fieldNode.childForFieldName('name')
    if (!nameNode) return null

    const fieldName = sourceCode.substring(nameNode.startIndex, nameNode.endIndex)

    const typeNode = fieldNode.childForFieldName('type')
    const originalType = typeNode ? sourceCode.substring(typeNode.startIndex, typeNode.endIndex) : 'any'
    const type = mapToSimpleType(originalType)

    const decorators = fieldNode.children.filter((child) => child.type === 'decorator')
    const decoratorTexts = decorators.map((d) => sourceCode.substring(d.startIndex, d.endIndex))

    const isPrimaryKey = decoratorTexts.some((d) => d.includes('@PrimaryKey') || d.includes('@PrimaryGeneratedColumn') || d.includes('@id'))
    const isNullable = originalType.includes('null') || originalType.includes('?') || originalType.includes('| undefined')

    return {
      name: fieldName,
      type,
      isPrimaryKey: isPrimaryKey || undefined,
      isNullable: isNullable || undefined,
      decorators: decoratorTexts.length > 0 ? decoratorTexts : undefined,
    }
  }

  private extractRelationships(classNode: Parser.SyntaxNode, sourceCode: string): EntityRelationship[] {
    const relationships: EntityRelationship[] = []
    const bodyNode = classNode.childForFieldName('body')
    if (!bodyNode) return relationships

    for (const member of bodyNode.children) {
      if (member.type === 'property_declaration' || member.type === 'public_field_definition') {
        const relationship = this.extractRelationship(member, sourceCode)
        if (relationship) {
          relationships.push(relationship)
        }
      }
    }

    return relationships
  }

  private extractRelationship(fieldNode: Parser.SyntaxNode, sourceCode: string): EntityRelationship | null {
    const decorators = fieldNode.children.filter((child) => child.type === 'decorator')
    const nameNode = fieldNode.childForFieldName('name')
    const fieldName = nameNode ? sourceCode.substring(nameNode.startIndex, nameNode.endIndex) : 'unknown'

    for (const decorator of decorators) {
      const decoratorText = sourceCode.substring(decorator.startIndex, decorator.endIndex)

      let relType: 'oneToMany' | 'manyToOne' | 'manyToMany' | 'oneToOne' | null = null

      if (decoratorText.includes('@OneToMany')) relType = 'oneToMany'
      else if (decoratorText.includes('@ManyToOne')) relType = 'manyToOne'
      else if (decoratorText.includes('@ManyToMany')) relType = 'manyToMany'
      else if (decoratorText.includes('@OneToOne')) relType = 'oneToOne'

      if (relType) {
        const match = decoratorText.match(/=>\s*([A-Z][a-zA-Z0-9_]*)/)
        if (match && match[1]) {
          return {
            type: relType,
            targetEntity: match[1],
            fieldName,
          }
        }
      }
    }

    return null
  }

  private detectFrameworkFromSource(sourceCode: string): string | null {
    const frameworks: Record<string, string[]> = {
      typeorm: ['typeorm', '@Entity', '@Column', '@PrimaryGeneratedColumn'],
      prisma: ['@prisma/client', 'PrismaClient'],
      sequelize: ['sequelize', 'sequelize-typescript', '@Table', '@Column'],
      mongoose: ['mongoose', '@Schema', 'SchemaFactory'],
      drizzle: ['drizzle-orm'],
      mikroorm: ['@mikro-orm/core'],
    }

    for (const [name, patterns] of Object.entries(frameworks)) {
      if (patterns.some(p => sourceCode.includes(p))) {
        return name
      }
    }

    return null
  }

  private findInterfaceDeclarations(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const interfaces: Parser.SyntaxNode[] = []

    const traverse = (n: Parser.SyntaxNode) => {
      if (n.type === 'export_statement') {
        const declaration = n.childForFieldName('declaration')
        if (declaration && declaration.type === 'interface_declaration') {
          interfaces.push(declaration)
          return
        }
      } else if (n.type === 'interface_declaration') {
        if (n.parent?.type !== 'export_statement') {
          interfaces.push(n)
        }
      }
      n.children.forEach(traverse)
    }

    traverse(node)
    return interfaces
  }

  private detectEntityFromInterface(
    interfaceNode: Parser.SyntaxNode,
    sourceCode: string,
    filePath: string,
    service: string
  ): Entity | null {
    const nameNode = interfaceNode.childForFieldName('name')
    if (!nameNode) return null

    const interfaceName = sourceCode.substring(nameNode.startIndex, nameNode.endIndex)

    if (interfaceName.endsWith('Input') || interfaceName.endsWith('DTO') ||
        interfaceName.endsWith('Response') || interfaceName.endsWith('Request')) {
      return null
    }

    if (!this.shouldScanFile(filePath)) {
      return null
    }

    const fields = this.extractInterfaceFields(interfaceNode, sourceCode)

    if (fields.length === 0) {
      return null
    }

    const signals = ['interface in entity file']
    const confidence = 0.6

    return {
      name: interfaceName,
      service,
      framework: 'unknown',
      fields,
      relationships: [],
      confidence,
      signals,
    }
  }

  private extractInterfaceFields(interfaceNode: Parser.SyntaxNode, sourceCode: string): EntityField[] {
    const fields: EntityField[] = []
    const bodyNode = interfaceNode.childForFieldName('body')
    if (!bodyNode) return fields

    for (const member of bodyNode.children) {
      if (member.type === 'property_signature') {
        const field = this.extractInterfaceField(member, sourceCode)
        if (field) {
          fields.push(field)
        }
      }
    }

    return fields
  }

  private extractInterfaceField(fieldNode: Parser.SyntaxNode, sourceCode: string): EntityField | null {
    const nameNode = fieldNode.childForFieldName('name')
    if (!nameNode) return null

    const fieldName = sourceCode.substring(nameNode.startIndex, nameNode.endIndex)

    const typeNode = fieldNode.childForFieldName('type')
    const originalType = typeNode ? sourceCode.substring(typeNode.startIndex, typeNode.endIndex) : 'any'
    const type = mapToSimpleType(originalType)

    const lowerName = fieldName.toLowerCase()
    const isPrimaryKey = lowerName === 'id'
    const isNullable = originalType.includes('null') || originalType.includes('?') || originalType.includes('| undefined')

    return {
      name: fieldName,
      type,
      isPrimaryKey: isPrimaryKey || undefined,
      isNullable: isNullable || undefined,
    }
  }
}
