/**
 * The RAW half of every artifact-backed entity: the slice of the JSON store file
 * that holds it, pretty-printed, which is what the detail panes show when the
 * reader flips a view to its artifact. One function per kind the route addresses
 * (`interface`, `flow`, `claim`, `dependency`, `recipe`), each re-serializing the
 * fixture the VIEW half already answered with, so the two readings of one entity
 * can never disagree.
 *
 * `recipe` is the singleton kind: a repo has one, so it is addressed by no id.
 */

import type { GuardArtifactSource } from '@/preview/vendor/shared';
import type { GuardArtifactKind } from '@/preview/vendor/lib/api';
import { dependenciesView } from './dependency-fixtures';
import { claimsView, flowDetail, recipeCard } from './flow-fixtures';
import { interfacesView } from './interface-fixtures';

const FILE: Record<GuardArtifactKind, string> = {
  interface: 'guard/interfaces.json',
  flow: 'scenarios/flows.json',
  claim: 'guard/claims.json',
  dependency: 'scenarios/dependencies.json',
  recipe: 'scenarios/recipe.json',
};

function entryFor(repoId: string, kind: GuardArtifactKind, id: string): unknown {
  switch (kind) {
    case 'interface':
      return interfacesView(repoId).interfaces.find((i) => i.id === id) ?? null;
    case 'flow':
      return flowDetail(repoId, id);
    case 'claim':
      return claimsView(repoId).claims.find((c) => c.id === id) ?? null;
    case 'dependency':
      return dependenciesView(repoId).dependencies.find((d) => d.name === id) ?? null;
    case 'recipe':
      return recipeCard(repoId);
  }
}

/** One entity's stored entry, or null when nothing with that id is stored. */
export function artifactRaw(repoId: string, kind: string, id: string): GuardArtifactSource | null {
  if (!(kind in FILE)) return null;
  const artifactKind = kind as GuardArtifactKind;
  const entry = entryFor(repoId, artifactKind, id);
  if (entry === null || entry === undefined) return null;
  return {
    id,
    file: FILE[artifactKind],
    content: JSON.stringify(entry, null, 2),
  };
}
