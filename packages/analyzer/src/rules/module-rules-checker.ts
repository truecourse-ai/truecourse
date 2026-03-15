import type { ModuleInfo, MethodInfo, ModuleDependency, ModuleLevelDependency, AnalysisRule } from '@truecourse/shared'

export interface ModuleViolation {
  ruleKey: string
  title: string
  description: string
  severity: string
  serviceName: string
  moduleName?: string
  methodName?: string
  filePath: string
}

const GOD_MODULE_THRESHOLD = 15
const LONG_METHOD_STATEMENTS = 30
const TOO_MANY_PARAMS = 5
const DEEP_NESTING_THRESHOLD = 4

/**
 * Check deterministic module-level rules and return violations.
 */
export function checkModuleRules(
  modules: ModuleInfo[],
  methods: MethodInfo[],
  fileDependencies: ModuleDependency[],
  enabledRules: AnalysisRule[],
  moduleLevelDeps?: ModuleLevelDependency[],
  dbConnectedModuleKeys?: Set<string>,
): ModuleViolation[] {
  const violations: ModuleViolation[] = []
  const ruleKeys = new Set(enabledRules.filter(r => r.type === 'deterministic' && r.enabled).map(r => r.key))

  // God module
  if (ruleKeys.has('arch/god-module')) {
    for (const mod of modules) {
      if (mod.methodCount > GOD_MODULE_THRESHOLD) {
        violations.push({
          ruleKey: 'arch/god-module',
          title: `God module: ${mod.name}`,
          description: `${mod.name} has ${mod.methodCount} methods (threshold: ${GOD_MODULE_THRESHOLD}). Consider splitting into smaller, focused modules.`,
          severity: 'medium',
          serviceName: mod.serviceName,
          moduleName: mod.name,
          filePath: mod.filePath,
        })
      }
    }
  }

  // Long method
  if (ruleKeys.has('arch/long-method')) {
    for (const method of methods) {
      if (method.statementCount != null && method.statementCount > LONG_METHOD_STATEMENTS) {
        violations.push({
          ruleKey: 'arch/long-method',
          title: `Long method: ${method.moduleName}.${method.name}`,
          description: `${method.name} has ${method.statementCount} statements (threshold: ${LONG_METHOD_STATEMENTS}). Extract sub-routines to improve readability.`,
          severity: 'low',
          serviceName: method.serviceName,
          moduleName: method.moduleName,
          methodName: method.name,
          filePath: method.filePath,
        })
      }
    }
  }

  // Too many parameters
  if (ruleKeys.has('arch/too-many-parameters')) {
    for (const method of methods) {
      if (method.paramCount >= TOO_MANY_PARAMS) {
        violations.push({
          ruleKey: 'arch/too-many-parameters',
          title: `Too many parameters: ${method.moduleName}.${method.name}`,
          description: `${method.name} has ${method.paramCount} parameters (threshold: ${TOO_MANY_PARAMS}). Consider using an options object or splitting the function.`,
          severity: 'low',
          serviceName: method.serviceName,
          moduleName: method.moduleName,
          methodName: method.name,
          filePath: method.filePath,
        })
      }
    }
  }

  // Deeply nested logic
  if (ruleKeys.has('arch/deeply-nested-logic')) {
    for (const method of methods) {
      if (method.maxNestingDepth != null && method.maxNestingDepth > DEEP_NESTING_THRESHOLD) {
        violations.push({
          ruleKey: 'arch/deeply-nested-logic',
          title: `Deeply nested: ${method.moduleName}.${method.name}`,
          description: `${method.name} has nesting depth ${method.maxNestingDepth} (threshold: ${DEEP_NESTING_THRESHOLD}). Use early returns or extract helper functions to flatten the logic.`,
          severity: 'medium',
          serviceName: method.serviceName,
          moduleName: method.moduleName,
          methodName: method.name,
          filePath: method.filePath,
        })
      }
    }
  }

  // Unused export
  if (ruleKeys.has('arch/unused-export')) {
    // Build set of all imported names across the codebase
    const importedTargets = new Set<string>()
    for (const dep of fileDependencies) {
      for (const name of dep.importedNames) {
        importedTargets.add(name)
      }
    }

    // Check exported functions/classes that are never imported
    for (const method of methods) {
      if (method.isExported && !importedTargets.has(method.name)) {
        violations.push({
          ruleKey: 'arch/unused-export',
          title: `Unused export: ${method.name}`,
          description: `${method.name} is exported from ${method.moduleName} but never imported elsewhere in the codebase.`,
          severity: 'low',
          serviceName: method.serviceName,
          moduleName: method.moduleName,
          methodName: method.name,
          filePath: method.filePath,
        })
      }
    }

    // Check exported classes
    for (const mod of modules) {
      if (mod.kind === 'class' && !importedTargets.has(mod.name)) {
        // Check if the class name appears in any export of its file's analysis
        // If the class is exported (its file has exports), check
        if (mod.exportCount > 0 && !importedTargets.has(mod.name)) {
          violations.push({
            ruleKey: 'arch/unused-export',
            title: `Unused export: ${mod.name}`,
            description: `Class ${mod.name} appears exported but is never imported elsewhere in the codebase.`,
            severity: 'low',
            serviceName: mod.serviceName,
            moduleName: mod.name,
            filePath: mod.filePath,
          })
        }
      }
    }
  }

  // Dead module
  if (ruleKeys.has('arch/dead-module') && moduleLevelDeps) {
    const connectedModules = new Set<string>()
    for (const dep of moduleLevelDeps) {
      connectedModules.add(`${dep.sourceService}::${dep.sourceModule}`)
      connectedModules.add(`${dep.targetService}::${dep.targetModule}`)
    }

    for (const mod of modules) {
      const key = `${mod.serviceName}::${mod.name}`
      if (!connectedModules.has(key) && !dbConnectedModuleKeys?.has(key)) {
        violations.push({
          ruleKey: 'arch/dead-module',
          title: `Dead module: ${mod.name}`,
          description: `${mod.name} in ${mod.serviceName} has no incoming or outgoing dependencies — it may be unused.`,
          severity: 'low',
          serviceName: mod.serviceName,
          moduleName: mod.name,
          filePath: mod.filePath,
        })
      }
    }
  }

  return violations
}
