/**
 * The RECIPE as a destination — the preparation a SURFACE runs on, opened from
 * that surface's recipe row at the top of the Interfaces catalog.
 *
 * The reading is the structured card ({@link GuardRecipeCard}: the recipe's
 * fields, its fingerprint and its staleness). The stored `scenarios/recipe.json`
 * has no raw reading here — the server serves no masked recipe artifact — so no
 * mode switch is offered rather than one that leads nowhere.
 */

import type { GuardDriverId, GuardRecipeCard as GuardRecipeCardData } from '@truecourse/shared';
import { GuardRecipeCard } from './GuardRecipeCard';

/** Where the recipe lives — the file the card is a reading of. */
export const GUARD_RECIPE_FILE = '.truecourse/scenarios/recipe.json';

export function GuardRecipeDetail({
  recipe,
}: {
  /** The surface whose preparation is being read; the card is not yet scoped by it. */
  surface?: GuardDriverId;
  recipe: GuardRecipeCardData;
}) {
  return (
    <div role="region" aria-label="Recipe" className="h-full min-w-0 overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Preparation
        </span>
        <span className="font-mono text-[12px] text-foreground">{GUARD_RECIPE_FILE}</span>
      </div>
      <div className="mt-3">
        <GuardRecipeCard recipe={recipe} />
      </div>
    </div>
  );
}
