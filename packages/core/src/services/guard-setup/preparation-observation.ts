import { z } from 'zod';
import type { SessionDef } from '@truecourse/agent-loop';
import { credentialServers, resolveApiServers, resolveWebSurface, observationBinding, observationConfiguration, observationSource, RecipePreparationBaselineCheckSchema, type Recipe, type PreparationQualification } from '@truecourse/guard-runner';
import { readFileTool, readFilesTool, searchTool } from '../agent/repo-tools.js';

// Baselines address numeric object fields with the runner's dotted-path syntax.
// JSON Pointer (/totalCount) and JSONPath ($.totalCount) are different languages.
const NumericPathSchema = z.string().regex(
  /^[A-Za-z_][A-Za-z0-9_$-]*(?:\[\d+\])*(?:\.[A-Za-z_$][A-Za-z0-9_$-]*(?:\[\d+\])*)*$/,
  'Use a dotted response field path such as totalCount or result.data.count, not /totalCount or $.totalCount.',
);
const CheckSchema = RecipePreparationBaselineCheckSchema.omit({ qualification: true }).extend({
  counts: z.record(NumericPathSchema, z.number().int().nonnegative()).refine(v => Object.keys(v).length > 0, 'declare at least one global record count'),
  totals: z.record(NumericPathSchema, z.number().finite()).optional(),
});
export const ObservationReviewSchema = z.object({
  candidates: z.array(z.object({
    check: CheckSchema,
    decision: z.enum(['instance', 'scoped', 'unknown']),
    entity: z.string().min(1), principalSemantics: z.string().min(1),
    implicitFilters: z.array(z.string()), counterevidence: z.array(z.string()), reason: z.string().min(1),
    sources: z.array(z.object({ path: z.string().min(1), start: z.number().int().positive(), end: z.number().int().positive(), role: z.enum(['handler', 'query', 'authorization']) }).strict()),
  }).strict()).max(12),
  findings: z.array(z.string().min(1)).min(1),
}).strict();
export type ObservationReview = z.infer<typeof ObservationReviewSchema>;

/** Names and capabilities only. Private worlds mint their own credential values. */
export function observationExecutionContract(recipe: Recipe) {
  const resolved = resolveApiServers(recipe);
  const seeds = [recipe.api?.seed, ...Object.values(recipe.preparations ?? {}).map(profile => profile.seed)];
  const credentials = seeds.flatMap(seed => Object.entries(seed?.provides.credentials ?? {}).map(([name, declaration]) => ({
    name, servers: credentialServers(declaration, resolved),
  })));
  return {
    servers: [...resolved.servers.keys()],
    defaultServer: resolved.servers.size ? resolved.defaultServer : null,
    webFallback: resolved.servers.size === 0 && resolveWebSurface(recipe) !== null,
    credentials,
  };
}

function validateExecutionContract(recipe: Recipe, check: ObservationReview['candidates'][number]['check']) {
  const contract = observationExecutionContract(recipe);
  const server = check.server ?? contract.defaultServer;
  if (!(server && contract.servers.includes(server)) && !(check.server === undefined && contract.webFallback)) {
    throw Error(`Baseline server ${JSON.stringify(check.server ?? null)} is not declared. Available API servers: ${contract.servers.join(', ') || 'none'}. ${contract.webFallback ? 'Omit server to use the web surface.' : `Omit server to use the default (${contract.defaultServer ?? 'none'}).`} An external dependency name does not select a server.`);
  }
  if (check.credential && !contract.credentials.some(credential =>
    credential.name === check.credential && (contract.webFallback || (server !== null && credential.servers.includes(server))))) {
    const names = contract.credentials.filter(credential => contract.webFallback || (server !== null && credential.servers.includes(server))).map(credential => credential.name);
    throw Error(`Baseline credential ${JSON.stringify(check.credential)} is not declared by a seed for this server. Available seed credentials: ${[...new Set(names)].join(', ') || 'none'}. For an unauthenticated route, omit credential entirely; put the authentication explanation in principalSemantics.`);
  }
}

export function qualifyObservations(repoRoot: string, recipe: Recipe, review: ObservationReview) {
  review = ObservationReviewSchema.parse(review);
  const approvals = new Map<string, PreparationQualification>();
  for (const candidate of review.candidates) {
    if (candidate.decision !== 'instance') continue;
    validateExecutionContract(recipe, candidate.check);
    if (candidate.implicitFilters.length || candidate.counterevidence.length) throw Error('An observation with implicit filters or counterevidence cannot qualify as instance-wide.');
    if (!['handler', 'query', 'authorization'].every(role => candidate.sources.some(s=>s.role===role))) throw Error('Instance observations need handler, count-query and authorization source evidence.');
    const sources = candidate.sources.map(source => {
      const actual = observationSource(repoRoot, source.path);
      if (source.end < source.start || source.end > actual.body.split('\n').length) throw Error('Observation source range does not exist.');
      return {...source, sha256: actual.sha256};
    });
    const binding = observationBinding(candidate.check);
    if (approvals.has(binding)) throw Error('Duplicate observation review; provide one decision per check.');
    approvals.set(binding, { version: 1, scope: 'instance', binding, configuration: observationConfiguration(recipe), reason: `${candidate.entity}: ${candidate.reason} Principal scope: ${candidate.principalSemantics}`, sources });
  }
  // A contradictory decision must not be hidden behind a second instance entry.
  for (const c of review.candidates) if (c.decision !== 'instance' && approvals.has(observationBinding(c.check))) throw Error('Contradictory observation decisions.');
  return approvals;
}
export function preparationObservationSession(repoRoot: string, recipe: Recipe): SessionDef<ObservationReview> {
  return {
    kind: 'guard-setup.preparation-observations', display: { title: 'Preparation observation review' },
    budget: { turns: 20, maxResumes: 0, tokenCeiling: 100000 },
    systemPrompt: `Review APPLICATION BASELINE OBSERVATIONS before any seed scripts are authored or executed. This is a read-only source qualification, not script authoring.
Find supported GET JSON observations of instance-wide business counts/totals. Follow the handler into the actual query and authorization logic. Cite handler, query and authorization ranges. Test descriptions and route names alone do not establish scope. An authenticated endpoint can be global only if its principal is demonstrably allowed to observe all records; admin labels alone prove nothing.
Mark scoped when any implicit tenant/user/team/folder/status/deletion filter excludes business rows. Exact SQL COUNT over a filtered query is still scoped. Page lengths, capped/windowed counts, a response field named count, and no explicit query parameters prove nothing. Counterexample: principal A sees zero while B owns records; A's count is not global. Follow helper functions and defaults. Do not discard counterevidence to get an instance decision. Opaque queries or missing evidence are unknown.
For each candidate give endpoint/server/query/credential, count and total JSON paths, entity, principal semantics, all implicit filters, counterevidence, reason and actual source ranges. counts/totals values are placeholders for subsequent known seed inputs; they are not proof. Do not expose credentials. Include findings even if no suitable candidate is established. This bounded source review is fallible, not a mathematical proof. Do not fabricate a global endpoint or switch to SQL observations.
Execution contract: ${JSON.stringify(observationExecutionContract(recipe))}
Use only these resolved API server names, or omit server for the default/web surface. The recipe's api property is not a server named api. For unauthenticated routes omit credential entirely; never write null, none or an explanation as a credential name. For authenticated routes use a declared seed credential available on the selected server; private preparations must mint that credential themselves. Put authentication explanations in principalSemantics. Response paths use dotted fields such as totalCount or result.data.count, never /totalCount or $.totalCount. External services are dependencies only when an observation actually calls them; merely sharing a server does not require their accounts.
Return instance only with affirmative source evidence for the full query/authorization chain and no scope counterevidence. Do not generate or run a preparation script.`,
    tools: [readFileTool(repoRoot), readFilesTool(repoRoot), searchTool(repoRoot)],
    outcomeSchema: ObservationReviewSchema,
    outcomeSchemaRepairs: 2,
    validateOutcome(value) {
      try { qualifyObservations(repoRoot, recipe, value); } catch (error) { return error instanceof Error ? error.message : String(error); }
      return undefined;
    },
  };
}
