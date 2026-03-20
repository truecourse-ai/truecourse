import type {
  FlowStepType,
  FlowTrigger,
} from '@truecourse/shared'
import { AnalysisGraph } from './analysis-graph.js'

// Re-export types from analysis-graph for backward compatibility
export type { CrossServiceCall, RouteHandler, AnalysisGraphInput } from './analysis-graph.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TracedFlowStep {
  stepOrder: number
  sourceService: string
  sourceModule: string
  sourceMethod: string
  targetService: string
  targetModule: string
  targetMethod: string
  stepType: FlowStepType
  isAsync: boolean
  isConditional: boolean
}

export interface TracedFlow {
  name: string
  entryService: string
  entryModule: string
  entryMethod: string
  category: string
  trigger: FlowTrigger
  steps: TracedFlowStep[]
}

// ---------------------------------------------------------------------------
// Core algorithm (using AnalysisGraph)
// ---------------------------------------------------------------------------

const MAX_DEPTH = 20

export function traceFlows(graph: AnalysisGraph): TracedFlow[] {
  const flows: TracedFlow[] = []

  for (const { method: entryMethod, module: entryModule } of graph.entryPoints) {
    const steps: TracedFlowStep[] = []
    const visited = new Set<string>()
    let stepOrder = 0

    function dfs(callerService: string, callerModule: string, callerMethod: string, depth: number) {
      if (depth >= MAX_DEPTH) return
      const key = `${callerService}::${callerModule}::${callerMethod}`
      if (visited.has(key)) return
      visited.add(key)

      // Follow method dependencies (shared adjacency from AnalysisGraph)
      const deps = graph.adjacency.get(key) || []
      for (const dep of deps) {
        const calleeKey = `${dep.calleeService}::${dep.calleeModule}::${dep.calleeMethod}`
        if (visited.has(calleeKey)) continue
        const calleeInfo = graph.methodByKey.get(calleeKey)

        // Shared classification from AnalysisGraph
        const stepType = graph.classifyStep(callerService, dep.calleeService, dep.calleeModule, dep.calleeMethod)

        stepOrder++
        steps.push({
          stepOrder,
          sourceService: callerService, sourceModule: callerModule, sourceMethod: callerMethod,
          targetService: dep.calleeService, targetModule: dep.calleeModule, targetMethod: dep.calleeMethod,
          stepType: (stepType === 'db-read' || stepType === 'db-write') ? 'call' : stepType,
          isAsync: calleeInfo?.isAsync ?? false, isConditional: false,
        })

        if (stepType === 'db-read' || stepType === 'db-write') {
          const dbInfo = graph.serviceDbMap.get(dep.calleeService)
          stepOrder++
          steps.push({
            stepOrder,
            sourceService: dep.calleeService, sourceModule: dep.calleeModule, sourceMethod: dep.calleeMethod,
            targetService: dbInfo?.name || 'Database', targetModule: dbInfo?.type || 'unknown',
            targetMethod: stepType === 'db-write' ? 'write' : 'query',
            stepType, isAsync: true, isConditional: false,
          })
        }

        dfs(dep.calleeService, dep.calleeModule, dep.calleeMethod, depth + 1)
      }

      // Follow cross-service HTTP calls (shared resolution from AnalysisGraph)
      const bestCall = graph.getCrossServiceCall(callerService, callerModule, callerMethod)
      if (bestCall) {
        const handler = graph.resolveHandler(bestCall)
        if (handler) {
          const handlerKey = `${handler.method.serviceName}::${handler.method.moduleName}::${handler.method.name}`
          if (!visited.has(handlerKey)) {
            stepOrder++
            steps.push({
              stepOrder,
              sourceService: callerService, sourceModule: callerModule, sourceMethod: callerMethod,
              targetService: handler.method.serviceName, targetModule: handler.method.moduleName, targetMethod: handler.method.name,
              stepType: 'http', isAsync: true, isConditional: false,
            })
            dfs(handler.method.serviceName, handler.method.moduleName, handler.method.name, depth + 1)
          }
        }
      }
    }

    dfs(entryMethod.serviceName, entryMethod.moduleName, entryMethod.name, 0)
    if (steps.length === 0) continue

    const layer = entryModule.layerName.toLowerCase()
    const trigger: FlowTrigger =
      ['api', 'controller', 'route'].includes(layer) ? 'http' :
      ['event', 'listener', 'subscriber'].includes(layer) ? 'event' : 'startup'

    // Prepend trigger step
    for (const s of steps) s.stepOrder++
    if (trigger === 'http') {
      steps.unshift({
        stepOrder: 1,
        sourceService: graph.hasFrontend ? 'Browser' : 'HTTP Client',
        sourceModule: graph.hasFrontend ? 'Browser' : 'HTTP Client',
        sourceMethod: 'request',
        targetService: entryMethod.serviceName, targetModule: entryMethod.moduleName, targetMethod: entryMethod.name,
        stepType: 'http', isAsync: false, isConditional: false,
      })
    } else if (trigger === 'event') {
      steps.unshift({
        stepOrder: 1,
        sourceService: 'Event Bus', sourceModule: 'Event Bus', sourceMethod: 'emit',
        targetService: entryMethod.serviceName, targetModule: entryMethod.moduleName, targetMethod: entryMethod.name,
        stepType: 'event', isAsync: true, isConditional: false,
      })
    } else {
      steps.unshift({
        stepOrder: 1,
        sourceService: 'System', sourceModule: 'System', sourceMethod: 'start',
        targetService: entryMethod.serviceName, targetModule: entryMethod.moduleName, targetMethod: entryMethod.name,
        stepType: 'call', isAsync: false, isConditional: false,
      })
    }

    flows.push({
      name: `${entryModule.name}.${entryMethod.name}`,
      entryService: entryMethod.serviceName,
      entryModule: entryMethod.moduleName,
      entryMethod: entryMethod.name,
      category: ['api', 'controller'].includes(layer) ? 'api' : layer === 'data' ? 'data' : layer === 'service' ? 'service' : 'general',
      trigger,
      steps,
    })
  }

  // Dedup: remove flows whose entry is reached as cross-service step in another flow
  if (graph.crossServiceCallsByMethod.size > 0 || graph.crossServiceCallsByModule.size > 0) {
    const reachedViaHttp = new Set<string>()
    for (const flow of flows) {
      for (const step of flow.steps) {
        if (step.stepType === 'http' && step.targetService !== flow.entryService) {
          reachedViaHttp.add(`${step.targetService}::${step.targetModule}::${step.targetMethod}`)
        }
      }
    }
    return flows.filter((f) => !reachedViaHttp.has(`${f.entryService}::${f.entryModule}::${f.entryMethod}`))
  }
  return flows
}
