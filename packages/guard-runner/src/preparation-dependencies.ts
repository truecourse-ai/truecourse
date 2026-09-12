import { prerequisiteProblems, resolveGuardPrerequisite } from '@truecourse/shared';
import { resolvePrerequisites, scenarioAccountEnvironment } from './prerequisites.js';
import type { Recipe } from './recipe.js';

/** Only registration status and declarations enter the authoring conversation. */
export function preparationDependencyBriefing(repoRoot: string, recipe: Recipe) {
  const resolved = resolvePrerequisites(repoRoot, recipe.api?.externals);
  return {
    catalog: resolved.dependencies.dependencies.map(d => ({
      name: d.name, class: d.entry.class, summary: d.entry.summary,
      services: d.entry.services ?? [], state: d.state,
      condition: d.entry.condition, obtain: d.entry.obtain,
      registrationKind: d.entry.registration?.kind,
      requirements: d.requirements.map(r => ({ field: r.field, resolved: r.resolved, optional: r.optional ?? false })),
    })),
    services: resolved.targets.map(t => ({ name: t.name, aliases: t.aliases, state: t.state })),
  };
}

/** The same catalog/legacy-service resolution as scenario execution, before scripts run. */
export function resolvePreparationDependencies(repoRoot: string, recipe: Recipe, needs: string[]) {
  const resolved = resolvePrerequisites(repoRoot, recipe.api?.externals);
  const supplied = needs.filter(name => !resolved.dependencies.dependencies.some(d => d.name === name && d.state === null));
  const problem = prerequisiteProblems(supplied.map(dependency => ({ dependency, mode: 'provided' })), resolved.targets)[0];
  if (problem) throw new Error(`Preparation dependency "${problem.dependency}" is unavailable: ${problem.reason}`);
  for (const name of supplied) {
    const match = resolveGuardPrerequisite(name, resolved.targets);
    const dependency = match.kind === 'resolved'
      ? resolved.dependencies.dependencies.find(d => d.name === match.target.name) : undefined;
    if (dependency?.entry.registration && dependency.entry.registration.kind !== 'env')
      throw new Error(`Preparation dependency "${name}" requires ${dependency.entry.registration.kind} materialization, which preparation scripts do not support`);
  }
  return scenarioAccountEnvironment({ needs }, resolved);
}
