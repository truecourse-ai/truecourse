import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects Airflow 2.x APIs that have been removed, moved, or changed
 * in Airflow 3. Flags imports and usages that need migration.
 */
const DEPRECATED_AIRFLOW_IMPORTS: Array<{ module: string; name?: string; replacement: string }> = [
  // Moved to provider packages
  { module: 'airflow.operators.bash_operator', name: 'BashOperator', replacement: 'airflow.providers.standard.operators.bash.BashOperator' },
  { module: 'airflow.operators.python_operator', name: 'PythonOperator', replacement: 'airflow.operators.python.PythonOperator' },
  { module: 'airflow.operators.email_operator', replacement: 'airflow.providers.smtp.operators.smtp' },
  { module: 'airflow.operators.hive_operator', replacement: 'airflow.providers.apache.hive.operators.hive' },
  { module: 'airflow.operators.mysql_operator', replacement: 'airflow.providers.mysql.operators.mysql' },
  { module: 'airflow.operators.postgres_operator', replacement: 'airflow.providers.postgres.operators.postgres' },
  { module: 'airflow.operators.slack_operator', replacement: 'airflow.providers.slack.operators.slack' },
  { module: 'airflow.operators.docker_operator', replacement: 'airflow.providers.docker.operators.docker' },
  { module: 'airflow.operators.http_operator', replacement: 'airflow.providers.http.operators.http' },
  { module: 'airflow.sensors.http_sensor', replacement: 'airflow.providers.http.sensors.http' },
  { module: 'airflow.sensors.sql_sensor', replacement: 'airflow.providers.common.sql.sensors.sql' },
  { module: 'airflow.hooks.http_hook', replacement: 'airflow.providers.http.hooks.http' },
  { module: 'airflow.hooks.mysql_hook', replacement: 'airflow.providers.mysql.hooks.mysql' },
  { module: 'airflow.hooks.postgres_hook', replacement: 'airflow.providers.postgres.hooks.postgres' },
  // Removed APIs
  { module: 'airflow.contrib', replacement: 'appropriate airflow.providers package' },
  { module: 'airflow.utils.dates', name: 'days_ago', replacement: 'datetime or pendulum for scheduling' },
  // Renamed
  { module: 'airflow.operators.dummy', replacement: 'airflow.operators.empty' },
  { module: 'airflow.operators.dummy_operator', replacement: 'airflow.operators.empty' },
]

export const pythonAirflow3MigrationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/airflow-3-migration',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        const moduleName = child.type === 'aliased_import'
          ? child.namedChildren[0]?.text
          : child.text
        if (!moduleName) continue

        const deprecated = DEPRECATED_AIRFLOW_IMPORTS.find(
          (d) => !d.name && (moduleName === d.module || moduleName.startsWith(d.module + '.')),
        )
        if (deprecated) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Airflow 3 migration required',
            `'${moduleName}' has been moved/removed in Airflow 3 — use '${deprecated.replacement}' instead.`,
            sourceCode,
            `Replace import with '${deprecated.replacement}'.`,
          )
        }
      }
    }

    if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName('module_name')
      if (!moduleNode) return null
      const moduleName = moduleNode.text

      // Check module-level deprecation
      const moduleDep = DEPRECATED_AIRFLOW_IMPORTS.find(
        (d) => !d.name && (moduleName === d.module || moduleName.startsWith(d.module + '.')),
      )
      if (moduleDep) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Airflow 3 migration required',
          `'${moduleName}' has been moved/removed in Airflow 3 — use '${moduleDep.replacement}' instead.`,
          sourceCode,
          `Replace import with '${moduleDep.replacement}'.`,
        )
      }

      // Check specific name imports
      for (const child of node.namedChildren) {
        if (child.type !== 'dotted_name' && child.type !== 'aliased_import') continue
        const importedName = child.type === 'aliased_import'
          ? child.namedChildren[0]?.text
          : child.text
        if (!importedName) continue

        const nameDep = DEPRECATED_AIRFLOW_IMPORTS.find(
          (d) => d.name && d.module === moduleName && d.name === importedName,
        )
        if (nameDep) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Airflow 3 migration required',
            `'${importedName}' from '${moduleName}' has been moved/removed in Airflow 3 — use '${nameDep.replacement}' instead.`,
            sourceCode,
            `Replace with import from '${nameDep.replacement}'.`,
          )
        }
      }
    }

    return null
  },
}
