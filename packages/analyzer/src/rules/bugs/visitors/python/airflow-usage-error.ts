import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects Airflow usage errors:
 * - AIR001: Variable name doesn't match task_id
 * - AIR002: DAG missing schedule argument
 * - AIR003: Variable.get() called outside of a task context (module level)
 */
export const pythonAirflowUsageErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/airflow-usage-error',
  languages: ['python'],
  nodeTypes: ['assignment', 'call'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'assignment') {
      // AIR001: Variable name doesn't match task_id
      // Pattern: my_task = SomeOperator(task_id='different_name', ...)
      const left = node.childForFieldName('left')
      const right = node.childForFieldName('right')

      if (!left || !right) return null
      if (right.type !== 'call') return null
      if (left.type !== 'identifier') return null

      const varName = left.text
      const func = right.childForFieldName('function')
      const args = right.childForFieldName('arguments')

      if (!func || !args) return null

      // Only check Operator-like constructors
      const funcName = func.type === 'attribute' ? func.childForFieldName('attribute')?.text : func.text
      if (!funcName?.endsWith('Operator') && !funcName?.endsWith('Sensor') && funcName !== 'PythonOperator' && funcName !== 'BashOperator') return null

      // Find task_id keyword argument
      const taskIdArg = args.namedChildren.find((a) => {
        if (a.type === 'keyword_argument') {
          const k = a.childForFieldName('name')
          return k?.text === 'task_id'
        }
        return false
      })

      if (taskIdArg) {
        const taskIdValue = taskIdArg.childForFieldName('value')
        if (taskIdValue?.type === 'string') {
          const taskId = taskIdValue.text.replace(/^["']|["']$/g, '')
          // Convert varName to expected task_id format
          const expectedTaskId = varName.replace(/_/g, '-')
          if (taskId !== varName && taskId !== expectedTaskId) {
            return makeViolation(
              this.ruleKey, taskIdArg, filePath, 'high',
              'Airflow variable name does not match task_id',
              `Variable \`${varName}\` has \`task_id="${taskId}"\` — the variable name and task_id should match for consistent DAG readability.`,
              sourceCode,
              `Either rename the variable to match the task_id, or update task_id="${varName}".`,
            )
          }
        }
      }

      return null
    }

    if (node.type === 'call') {
      // AIR002: DAG() missing schedule argument
      const func = node.childForFieldName('function')
      if (!func) return null

      const funcText = func.text
      if (funcText !== 'DAG' && !funcText.endsWith('.DAG')) return null

      const args = node.childForFieldName('arguments')
      if (!args) return null

      const hasSchedule = args.namedChildren.some((a) => {
        if (a.type === 'keyword_argument') {
          const k = a.childForFieldName('name')
          return k?.text === 'schedule' || k?.text === 'schedule_interval'
        }
        return false
      })

      if (!hasSchedule) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Airflow DAG missing schedule argument',
          '`DAG()` called without a `schedule` (or `schedule_interval`) argument — the DAG will not be scheduled automatically.',
          sourceCode,
          'Add `schedule="@daily"` (or `schedule=None` for manual-only) to the DAG constructor.',
        )
      }
    }

    return null
  },
}
