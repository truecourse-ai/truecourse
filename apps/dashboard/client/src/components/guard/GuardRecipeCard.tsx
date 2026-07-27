/**
 * The preparation-recipe card at the top of the Scenarios tab — the committed
 * `recipe.json` (`build` + entry argv + env) plus its short inputs fingerprint,
 * provenance, and a staleness signal (inputs changed since the last run). Compact
 * and read-only: the recipe is discovered + human-reviewed at first generate and
 * refreshed only via `truecourse guard recipe --refresh`.
 */

import { AlertTriangle, CheckCircle2, Hammer } from 'lucide-react';
import type { GuardRecipeCard as GuardRecipeCardData } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import { shortFingerprint } from '@/lib/guard-drifts';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';
const CODE = 'rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground break-all';

export function GuardRecipeCard({ recipe }: { recipe: GuardRecipeCardData }) {
  const envEntries = Object.entries(recipe.env ?? {});

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Hammer className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Recipe</span>
        <HoverPopover portal
          width="narrow"
          align="start"
          content="How guard turns the working tree into a runnable entrypoint — discovered once, human-reviewed, reused every run."
        >
          <span className="text-[10px] text-muted-foreground">preparation</span>
        </HoverPopover>
        {recipe.stale === true && (
          <HoverPopover portal
            align="end"
            width="wide"
            content="The recipe-discovery inputs (package.json, lockfile, build config) changed since the last run recorded its fingerprint — the recipe may need re-discovery (truecourse guard recipe --refresh)."
          >
            <span className="ml-auto inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              inputs changed
            </span>
          </HoverPopover>
        )}
        {recipe.stale === false && (
          <HoverPopover portal width="narrow" align="end" content="The recipe inputs match the last run's fingerprint.">
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              current
            </span>
          </HoverPopover>
        )}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <div className={LABEL}>Build</div>
          <code className={`${CODE} mt-1 block`}>{recipe.build}</code>
        </div>
        {recipe.entry && (
          <div>
            <div className={LABEL}>Entry</div>
            <code className={`${CODE} mt-1 block`}>{recipe.entry.join(' ')}</code>
          </div>
        )}
        {recipe.serve && (
          <div>
            <div className={LABEL}>Serve</div>
            <code className={`${CODE} mt-1 block`}>{recipe.serve.join(' ')}</code>
          </div>
        )}
      </div>

      {envEntries.length > 0 && (
        <div className="mt-2">
          <div className={LABEL}>Env</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {envEntries.map(([k, v]) => (
              <code key={k} className={CODE}>
                {k}={v}
              </code>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <HoverPopover portal width="narrow" align="start" content="Recipe-discovery inputs fingerprint (sha256 over package.json, lockfile, build config).">
          <span className="font-mono">fingerprint {shortFingerprint(recipe.fingerprint)}</span>
        </HoverPopover>
        <span>·</span>
        <span>Committed · reviewed at first generate</span>
      </div>
    </div>
  );
}
