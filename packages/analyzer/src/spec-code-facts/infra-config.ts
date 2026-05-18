import { basename } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import type { CodeFact } from '@truecourse/shared'
import { EXTRACTORS } from './metadata.js'
import { pushFact } from './utils.js'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string') return [value]
  return []
}

export function extractInfraConfigFacts(sourceFile: string, content: string, facts: CodeFact[]): void {
  const fileName = basename(sourceFile)
  if (!/ya?ml$/i.test(fileName)) return

  let parsed: unknown
  try {
    parsed = loadYaml(content)
  } catch {
    return
  }
  const root = record(parsed)

  if (fileName === 'docker-compose.yml' || fileName === 'docker-compose.yaml') {
    const services = record(root.services)
    for (const [name, serviceValue] of Object.entries(services).sort(([a], [b]) => a.localeCompare(b))) {
      const service = record(serviceValue)
      pushFact(facts, sourceFile, undefined, 'infra.compose.service', 'service.defined', {
        name,
        image: typeof service.image === 'string' ? service.image : undefined,
        build: service.build !== undefined,
        ports: stringArray(service.ports),
        dependsOn: Array.isArray(service.depends_on) ? service.depends_on : Object.keys(record(service.depends_on)),
      }, EXTRACTORS.infraConfig)
    }
    return
  }

  if (/^\.github\/workflows\//.test(sourceFile)) {
    const jobs = record(root.jobs)
    for (const [name, jobValue] of Object.entries(jobs).sort(([a], [b]) => a.localeCompare(b))) {
      const job = record(jobValue)
      const steps = Array.isArray(job.steps) ? job.steps.map(record) : []
      pushFact(facts, sourceFile, undefined, 'infra.ci.job', 'job.defined', {
        name,
        runsOn: job['runs-on'],
        steps: steps.map((step) => ({
          name: typeof step.name === 'string' ? step.name : undefined,
          uses: typeof step.uses === 'string' ? step.uses : undefined,
          run: typeof step.run === 'string' ? step.run : undefined,
        })),
      }, EXTRACTORS.infraConfig)
    }
  }
}
