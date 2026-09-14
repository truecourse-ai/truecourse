import { observationBinding, observationConfiguration, observationSource, type Recipe } from '@truecourse/guard-runner';

/** Simulates the reviewed whole-instance fixture API, not a production qualification bypass. */
export function qualifyFixtureChecks(root: string, recipe: Recipe, checks: NonNullable<NonNullable<Recipe['preparations']>[string]['baselineChecks']>, relative = 'scripts/server.mjs') {
  const source = observationSource(root, relative);
  for (const check of checks) check.qualification = {
    version: 1, scope: 'instance', binding: observationBinding(check), configuration: observationConfiguration(recipe),
    reason: 'Fixture API reads all records in its owned file; world token authenticates without row filtering.',
    sources: (['handler', 'query', 'authorization'] as const).map(role=>({ role, path: relative, start: 1, end: source.body.split('\n').length, sha256: source.sha256 })),
  };
}
export function qualifyFixtureRecipe(root: string, recipe: Recipe, relative = 'scripts/server.mjs') {
  for (const profile of Object.values(recipe.preparations ?? {})) qualifyFixtureChecks(root, recipe, profile.baselineChecks ?? [], relative);
}
export const fixtureReview = {
  candidates: [{
    check: {path: '/rows', credential: 'owner', counts: {count: 0}, totals: {total: 0}},
    decision: 'instance', entity: 'fixture ledger', principalSemantics: 'World token grants all rows in the owned file',
    implicitFilters: [], counterevidence: [], reason: 'All rows are counted without row authorization filters',
    sources: ['handler', 'query', 'authorization'].map(role=>({role, path: 'scripts/server.mjs', start: 1, end: 1})),
  }], findings: ['Fixture API has an instance-wide count'],
};
