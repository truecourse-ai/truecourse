/**
 * The RECIPE as a destination, the preparation a SURFACE runs on, opened from
 * that surface's recipe row at the top of the Interfaces catalog.
 *
 * It is artifact-backed like every other guard entity, so it wears the same two
 * readings and no third: the structured card ({@link GuardRecipeCard}, the
 * surface's own fields, fingerprint and staleness), or the stored
 * `scenarios/recipe.json` verbatim.
 *
 * The CARD is what the surface scopes: cli reads its install/build/entrypoint,
 * api the server it talks to (its own, or the web surface's, the runner serves
 * one surface for both web and request steps), web the web block. The RAW reading
 * is never scoped, a file read verbatim is the whole file, and a "verbatim" that
 * hid half of it would be the one reading a reader cannot trust.
 *
 * Verbatim, with one exception the server owns: an inline credential value is
 * MASKED before it leaves the driver, exactly as `truecourse guard recipe` masks
 * it. The recipe is committed, so what may be read of it is the same in both
 * places, and the raw mode can never become the door that prints a secret the
 * card would not.
 */

import type { GuardDriverId, GuardRecipeCard as GuardRecipeCardData } from '@/preview/vendor/shared';
import { ArtifactModeSwitch, ArtifactRaw, useArtifactMode } from '@/preview/ui/artifact-view';
import { useGuardArtifactRaw } from '@/preview/vendor/hooks/useGuardArtifactRaw';
import { GuardRecipeCard } from '@/preview/vendor/components/guard/GuardRecipeCard';

/** Where the recipe lives, the file both readings are of. */
export const GUARD_RECIPE_FILE = '.truecourse/scenarios/recipe.json';

export function GuardRecipeDetail({
  repoId,
  recipe,
  surface,
  prRef,
}: {
  repoId: string;
  recipe: GuardRecipeCardData;
  /** The surface whose preparation is being read; omit for the whole recipe. */
  surface?: GuardDriverId;
  /** The PR head ref scoping the read (EE); undefined at repo level. */
  prRef?: string;
}) {
  const { mode, setMode, raw } = useArtifactMode('JSON');
  // The singleton kind: one recipe per repo, addressed by no id.
  const source = useGuardArtifactRaw(repoId, 'recipe', null, raw, prRef);

  return (
    <div role="region" aria-label="Recipe" className="h-full min-w-0 overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Preparation
        </span>
        <span className="font-mono text-[12px] text-foreground">{GUARD_RECIPE_FILE}</span>
        <ArtifactModeSwitch format="JSON" mode={mode} onSelect={setMode} className="ml-auto" />
      </div>
      {raw ? (
        <>
          <ArtifactRaw content={source.content} label="recipe source" />
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            An inline credential value is masked here.
          </p>
        </>
      ) : (
        <div className="mt-3">
          <GuardRecipeCard recipe={recipe} {...(surface ? { surface } : {})} />
        </div>
      )}
    </div>
  );
}
