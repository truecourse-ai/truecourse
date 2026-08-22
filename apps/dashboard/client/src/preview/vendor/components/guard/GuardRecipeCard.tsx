// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/components/guard/GuardRecipeCard.tsx; delete with the preview.
/**
 * The preparation recipe as a CARD, the structured half of {@link
 * GuardRecipeDetail}, which each surface's recipe row in the Interfaces catalog
 * opens. The committed `recipe.json` plus its short inputs fingerprint,
 * provenance, and a staleness signal (inputs changed since the last run).
 * Compact and read-only: the recipe is discovered + human-reviewed by
 * `truecourse guard setup` and re-derived only there.
 *
 * ONE GRAMMAR FOR EVERY SURFACE. The wire hands each surface the same shape
 * ({@link GuardRecipeSurface}), and this card renders it through one ordered
 * field list: label above value, in the same order, wherever the field appears.
 * A scope is a NARROWING, never a different page, the cli scope is not rows
 * while the web scope is a titled block, because two spellings of one idea is
 * exactly the drift the shared shape exists to prevent.
 *
 * SCOPED to one surface when the reader opened it from one: preparation is
 * per-surface, so a cli reader is shown the install, the build and the
 * entrypoint, an api reader the server it talks to, a web reader the web
 * surface, and none of them a block that belongs to somebody else. Unscoped
 * (no `surface`) it is every surface the recipe prepares, each under its own
 * name.
 *
 * It shows no credential: a secret is not preparation a reader needs, and the one
 * place a stored value may be read at all is the raw JSON beside this card, where
 * the server has already masked it.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Hammer } from 'lucide-react';
import type {
  GuardDriverId,
  GuardRecipeCard as GuardRecipeCardData,
  GuardRecipeSurface,
} from '@/preview/vendor/shared';
import { GUARD_DRIVERS, guardDriver } from '@/preview/vendor/shared';
import { HoverPopover } from '@/preview/ui/hover-popover';
import { shortFingerprint } from '@/preview/vendor/lib/guard-drifts';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';
const CODE = 'rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground break-all';

/** A value line, one command, one argv, one path. The card's only value shape. */
function Value({ children }: { children: ReactNode }) {
  return <code className={`${CODE} block`}>{children}</code>;
}

/** `K=V` chips, the one rendering of an env map, whichever surface declares it. */
function EnvRow({ env }: { env: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(env).map(([k, v]) => (
        <code key={k} className={CODE}>
          {k}={v}
        </code>
      ))}
    </div>
  );
}

/**
 * The field order EVERY scope reads in, one spec, so no surface invents its own
 * ordering, its own wording, or its own layout. A field the surface does not
 * declare renders nothing at all (`body` returns null); nothing is defaulted, and
 * no heading is left standing over an absence.
 */
const FIELDS: {
  label: string;
  /** Hover help on the label, where the field's meaning is not the label itself. */
  help?: string;
  /** Full width, for a field whose value is a list rather than one line. */
  wide?: boolean;
  body: (surface: GuardRecipeSurface) => ReactNode | null;
}[] = [
  { label: 'Install', body: (s) => (s.install ? <Value>{s.install}</Value> : null) },
  { label: 'Build', body: (s) => (s.build ? <Value>{s.build}</Value> : null) },
  { label: 'Entry', body: (s) => (s.entry ? <Value>{s.entry.join(' ')}</Value> : null) },
  // The default server's argv, unless the surface lists several, then every one
  // of them is below, and printing the default twice would say it twice.
  { label: 'Serve', body: (s) => (s.serve && !s.servers ? <Value>{s.serve.join(' ')}</Value> : null) },
  {
    label: 'Servers',
    wide: true,
    body: (s) =>
      s.servers && s.servers.length > 0 ? (
        <>
          {s.servers.map((server) => (
            <div key={server.name}>
              <Value>
                {server.name}: {server.serve.join(' ')}
              </Value>
              {server.app && <div className="text-xs text-zinc-500">{server.app}</div>}
            </div>
          ))}
        </>
      ) : null,
  },
  {
    label: 'Services',
    help: 'One-shot datastore orchestration: `up` runs in the repo root once per run before any api test, `down` after the last one.',
    wide: true,
    body: (s) =>
      s.services ? (
        <>
          <Value>up: {s.services.up}</Value>
          {s.services.down && <Value>down: {s.services.down}</Value>}
        </>
      ) : null,
  },
  {
    label: 'Ready when',
    help: 'The surface is polled on this path until it answers, before the first step that needs it.',
    body: (s) => (s.healthPath ? <Value>{s.healthPath}</Value> : null),
  },
  {
    label: 'Ready timeout',
    body: (s) => (s.readyTimeoutMs != null ? <Value>{s.readyTimeoutMs} ms</Value> : null),
  },
  { label: 'Runs in', body: (s) => (s.cwd ? <Value>{s.cwd}</Value> : null) },
  {
    label: 'Env',
    wide: true,
    body: (s) => (s.env && Object.keys(s.env).length > 0 ? <EnvRow env={s.env} /> : null),
  },
];

/** One surface's declared fields, in the one order, as label-over-value rows. */
function SurfaceFields({ surface }: { surface: GuardRecipeSurface }) {
  const rows = FIELDS.map((field) => ({ field, body: field.body(surface) })).filter(
    (row) => row.body !== null,
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map(({ field, body }) => (
        <div key={field.label} className={field.wide ? 'sm:col-span-2' : undefined}>
          <div className={LABEL}>
            {field.help ? (
              <HoverPopover portal width="narrow" align="start" content={field.help}>
                <span className="underline decoration-dotted underline-offset-2">{field.label}</span>
              </HoverPopover>
            ) : (
              field.label
            )}
          </div>
          <div className="mt-1 space-y-1">{body}</div>
        </div>
      ))}
      {/* The one thing a field cannot say: whose server this is. The api surface
          of a repo with no `api` block is the WEB block's server, the runner
          serves one surface for both, so the rows above are real, and this line
          names their owner. */}
      {surface.sharedWithWeb && (
        <p className="text-[11px] leading-snug text-muted-foreground sm:col-span-2">
          Served by the same server as the web surface.
        </p>
      )}
    </div>
  );
}

export function GuardRecipeCard({
  recipe,
  surface,
}: {
  recipe: GuardRecipeCardData;
  /** Show only this surface's preparation; omit for every surface it prepares. */
  surface?: GuardDriverId;
}) {
  // Scoped: the one surface, if the recipe prepares it. Unscoped: every surface
  // it prepares, in the driver registry's order.
  const shown: [GuardDriverId, GuardRecipeSurface][] = (
    surface ? [surface] : GUARD_DRIVERS.map((d) => d.id)
  ).flatMap((id) => {
    const block = recipe.surfaces[id];
    return block ? [[id, block] as [GuardDriverId, GuardRecipeSurface]] : [];
  });

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
          content="How guard turns the working tree into a runnable entrypoint, discovered once, human-reviewed, reused every run."
        >
          <span className="text-[10px] text-muted-foreground">preparation</span>
        </HoverPopover>
        {recipe.stale === true && (
          <HoverPopover portal
            align="end"
            width="wide"
            content="The recipe-discovery inputs (package.json, lockfile, build config) changed since the last run recorded its fingerprint, the recipe may need re-discovery (truecourse guard recipe --refresh)."
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

      {shown.map(([id, block]) => (
        <div key={id} className="mt-2">
          {/* Unscoped, the surface's own word separates one block from the next;
              scoped, the card header above already said it. */}
          {!surface && (
            <div className="mb-1 text-[11px] font-semibold text-foreground">
              {guardDriver(id)?.label ?? id}
            </div>
          )}
          <SurfaceFields surface={block} />
        </div>
      ))}

      {shown.length === 0 && (
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
