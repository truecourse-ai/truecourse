import type { ModuleInfo, MethodInfo, ModuleDependency, ModuleLevelDependency, MethodLevelDependency, AnalysisRule, FileAnalysis } from '@truecourse/shared'

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
  methodLevelDeps?: MethodLevelDependency[],
  fileAnalyses?: FileAnalysis[],
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

  // Dead method
  if (ruleKeys.has('arch/dead-method') && methodLevelDeps) {
    const connectedMethods = new Set<string>()
    for (const dep of methodLevelDeps) {
      connectedMethods.add(`${dep.callerService}::${dep.callerModule}::${dep.callerMethod}`)
      connectedMethods.add(`${dep.calleeService}::${dep.calleeModule}::${dep.calleeMethod}`)
    }

    for (const method of methods) {
      const key = `${method.serviceName}::${method.moduleName}::${method.name}`
      if (!connectedMethods.has(key)) {
        violations.push({
          ruleKey: 'arch/dead-method',
          title: `Dead method: ${method.moduleName}.${method.name}`,
          description: `${method.name} in ${method.moduleName} (${method.serviceName}) has no incoming or outgoing calls — it may be unused.`,
          severity: 'low',
          serviceName: method.serviceName,
          moduleName: method.moduleName,
          methodName: method.name,
          filePath: method.filePath,
        })
      }
    }
  }

  // Orphan file
  if (ruleKeys.has('arch/orphan-file') && fileAnalyses) {
    const ENTRY_POINT_PATTERN = /(?:^|\/)(?:index|main|app|server)\.[^/]+$|(?:^|\/)route[^/]*\.[^/]+$|\.config\.[^/]+$|\.test\.[^/]+$|\.spec\.[^/]+$|(?:^|\/)__tests__\/|(?:^|\/)migrations\/|(?:^|\/)seeds\/|(?:^|\/)bin\/|(?:^|\/)scripts\//

    // Build set of all imported file paths (targets of dependencies)
    const importedFiles = new Set<string>()
    for (const dep of fileDependencies) {
      importedFiles.add(dep.target)
    }

    for (const fa of fileAnalyses) {
      if (importedFiles.has(fa.filePath)) continue
      if (ENTRY_POINT_PATTERN.test(fa.filePath)) continue

      // Determine which service this file belongs to
      const matchingModule = modules.find((m) => m.filePath === fa.filePath)
      const serviceName = matchingModule?.serviceName || 'unknown'
      const fileName = fa.filePath.split('/').pop() || fa.filePath

      violations.push({
        ruleKey: 'arch/orphan-file',
        title: `Orphan file: ${fileName}`,
        description: `${fa.filePath} is never imported by any other file in the codebase. It may be an unused module or a missing entry point.`,
        severity: 'low',
        serviceName,
        filePath: fa.filePath,
      })
    }
  }

  return violations
}
