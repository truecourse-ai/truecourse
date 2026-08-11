/**
 * The preparation recipe as a CARD — the structured half of {@link
 * GuardRecipeDetail}, which each surface group of the Interfaces catalog opens.
 * The committed `recipe.json` (`install` + `build` + entry/serve argv + datastore
 * services + the web surface + env) plus its short inputs fingerprint, provenance,
 * and a staleness signal (inputs changed since the last run). Compact and
 * read-only: the recipe is discovered + human-reviewed by `truecourse guard setup`
 * and re-derived only there.
 *
 * SCOPED to one surface when the reader opened it from one: preparation is
 * per-surface, so a cli reader is shown the install, the build and the entrypoint,
 * an api reader the servers and datastores, a web reader the web block — and none
 * of them a block that belongs to somebody else. Unscoped (no `surface`) it is the
 * whole recipe, which is what the raw reading beside it always is.
 *
 * It shows no credential: a secret is not preparation a reader needs, and the one
 * place a stored value may be read at all is the raw JSON beside this card, where
 * the server has already masked it.
 */

import { AlertTriangle, CheckCircle2, Hammer } from 'lucide-react';
import type { GuardDriverId, GuardRecipeCard as GuardRecipeCardData } from '@truecourse/shared';
import { guardDriver } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import { shortFingerprint } from '@/lib/guard-drifts';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';
const CODE = 'rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground break-all';

/** `K=V` chips — the one rendering of an env map, wherever it is declared. */
function EnvRow({ env }: { env: Record<string, string> }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {Object.entries(env).map(([k, v]) => (
        <code key={k} className={CODE}>
          {k}={v}
        </code>
      ))}
    </div>
  );
}

export function GuardRecipeCard({
  recipe,
  surface,
}: {
  recipe: GuardRecipeCardData;
  /** Show only this surface's preparation; omit for the whole recipe. */
  surface?: GuardDriverId;
}) {
  const envEntries = Object.entries(recipe.env ?? {});
  // What each surface prepares: the cli's install/build/entrypoint and the env
  // the sandbox inherits, the api block's servers and datastores, the web block.
  const shows = (which: GuardDriverId) => surface === undefined || surface === which;
  const cli = shows('cli');
  const api = shows('api');
  const web = shows('web');
  const hasApi = (recipe.servers && recipe.servers.length > 0) || recipe.serve || recipe.services;
  // A surface the recipe says nothing about (an api-less repo's api group, a web
  // group with no web block, a driver with no recipe kind at all) is told so.
  const declared = cli || (api && !!hasApi) || (web && !!recipe.web);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Hammer className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">
          {surface ? `${guardDriver(surface)?.label ?? surface} recipe` : 'Recipe'}
        </span>
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
            <span className="ml-auto inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
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
        {cli && recipe.install && (
          <div>
            <div className={LABEL}>Install</div>
            <code className={`${CODE} mt-1 block`}>{recipe.install}</code>
          </div>
        )}
        {cli && (
          <div>
            <div className={LABEL}>Build</div>
            <code className={`${CODE} mt-1 block`}>{recipe.build}</code>
          </div>
        )}
        {cli && recipe.entry && (
          <div>
            <div className={LABEL}>Entry</div>
            <code className={`${CODE} mt-1 block`}>{recipe.entry.join(' ')}</code>
          </div>
        )}
        {/* One "Serve" for a single-service repo; a multi-server recipe lists
            every service it declares, each with the workspace app it serves. */}
        {api &&
          (recipe.servers && recipe.servers.length > 0 ? (
            <div className="sm:col-span-2">
              <div className={LABEL}>Servers</div>
              <div className="mt-1 space-y-1">
                {recipe.servers.map((server) => (
                  <div key={server.name}>
                    <code className={`${CODE} block`}>
                      {server.name}: {server.serve.join(' ')}
                    </code>
                    {server.app && <div className="text-xs text-zinc-500">{server.app}</div>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            recipe.serve && (
              <div>
                <div className={LABEL}>Serve</div>
                <code className={`${CODE} mt-1 block`}>{recipe.serve.join(' ')}</code>
              </div>
            )
          ))}
        {api && recipe.services && (
          <div className="sm:col-span-2">
            <div className="flex items-center gap-1">
              <span className={LABEL}>Services</span>
              <HoverPopover portal
                width="narrow"
                align="start"
                content="One-shot datastore orchestration: `up` runs in the repo root once per run before any api scenario, `down` after the last one."
              >
                <span className="text-[10px] text-muted-foreground">datastores</span>
              </HoverPopover>
            </div>
            <div className="mt-1 space-y-1">
              <code className={`${CODE} block`}>up: {recipe.services.up}</code>
              {recipe.services.down && (
                <code className={`${CODE} block`}>down: {recipe.services.down}</code>
              )}
            </div>
          </div>
        )}
        {/* The web surface: how it is built, how it is started, and how the runner
            knows it is up. Its readiness IS its preparation — a surface answering
            its health path is the precondition of the first web step. */}
        {web && recipe.web && (
          <div className="sm:col-span-2">
            <div className="flex items-center gap-1">
              <span className={LABEL}>Web surface</span>
              <HoverPopover portal
                width="wide"
                align="start"
                content="Started once per run that has web steps, then polled on its readiness path until it answers before the first one."
              >
                <span className="text-[10px] text-muted-foreground">browsed</span>
              </HoverPopover>
            </div>
            <div className="mt-1 space-y-1">
              {recipe.web.build && <code className={`${CODE} block`}>build: {recipe.web.build}</code>}
              <code className={`${CODE} block`}>serve: {recipe.web.serve.join(' ')}</code>
              {recipe.web.healthPath && (
                <code className={`${CODE} block`}>ready when: {recipe.web.healthPath}</code>
              )}
              {recipe.web.cwd && <code className={`${CODE} block`}>runs in: {recipe.web.cwd}</code>}
            </div>
            {recipe.web.env && Object.keys(recipe.web.env).length > 0 && <EnvRow env={recipe.web.env} />}
          </div>
        )}
      </div>

      {cli && envEntries.length > 0 && (
        <div className="mt-2">
          <div className={LABEL}>Env</div>
          <EnvRow env={Object.fromEntries(envEntries)} />
        </div>
      )}

      {!declared && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          The recipe declares no preparation for this surface.
        </p>
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
