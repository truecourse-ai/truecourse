/**
 * The DEPENDENCIES tab, every class of starting state the program under test
 * needs, and what this machine provides for each.
 *
 * The house shape, not a card stack: the shared {@link EntityList} on the LEFT
 * (one row per catalog entry, plus every external service the recipe declares, its
 * name, WHAT IT IS, how many flows rely on it, and whether an instance is
 * registered), the chosen one's DETAIL on the right, under the same
 * {@link GuardTabStrip} + {@link useGuardTabs} model every other guard pane wears:
 * single-click previews a tab, double-click pins it, and the active one is
 * URL-synced as `?dependency=<name>`. So a row is a link a teammate can be sent, and the
 * needs-setup CTAs elsewhere in guard, which already link that way by service name,
 * land on it whichever row folded that service in.
 *
 * External services are one KIND of dependency here, not a surface of their own:
 * a supplied project, an authenticated config dir and a payment sandbox are the
 * same question asked three times, and one list answers it once.
 */

import { useMemo } from 'react';
import { AlertTriangle, Plug, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { CollapsibleAside } from '@/preview/ui/collapsible-aside';
import { EntityList } from '@/preview/ui/entity-list';
import { HoverPopover } from '@/preview/ui/hover-popover';
import { useGuardDependencies } from '@/preview/vendor/hooks/useGuardDependencies';
import { useGuardTabs } from '@/preview/vendor/hooks/useGuardTabs';
import {
  GUARD_DEPENDENCY_STATE,
  guardDependencyMatches,
  guardDependencyType,
} from '@/preview/vendor/lib/guard-dependencies';
import type { GuardDependenciesView, GuardDependencyRow } from '@/preview/vendor/types/guard-dependencies';
import { GuardDependencyDetail } from '@/preview/vendor/components/guard/GuardDependencyDetail';
import { GuardTabStrip, type GuardTabStripItem } from '@/preview/vendor/components/guard/GuardTabStrip';

const CHIP = 'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium';
const STATUS = 'inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground';
const DOT = 'h-2 w-2 shrink-0 rounded-full';

export interface GuardDependenciesPaneProps {
  repoId: string;
  /** Bumped by the page on a guard completion (`spec:complete`), a refetch signal. */
  reloadKey?: number;
  /** Jump into the Tests tab with one flow's detail open (`?flow=`). */
  onOpenFlow?: (flowId: string) => void;
}

export function GuardDependenciesPane({ repoId, reloadKey = 0, onOpenFlow }: GuardDependenciesPaneProps) {
  const { view, loading, error, save, saving } = useGuardDependencies(repoId, true, reloadKey);
  const { activeId, openTabs, open, close } = useGuardTabs('dependency', repoId);

  const rows = view?.dependencies ?? [];
  // A CTA elsewhere in guard names a SERVICE; the row it lands on may be keyed by
  // its catalog entry's name instead, and one entry may cover several services, so
  // every identity a row folded in resolves to it.
  const resolve = useMemo(() => {
    const byIdentity = new Map<string, GuardDependencyRow>();
    for (const d of rows) {
      for (const service of d.service?.services ?? []) if (!byIdentity.has(service)) byIdentity.set(service, d);
    }
    for (const d of rows) byIdentity.set(d.name, d);
    return (id: string | null): GuardDependencyRow | null => (id ? byIdentity.get(id) ?? null : null);
  }, [rows]);

  const active = resolve(activeId);

  // Each open tab reads by the dependency it resolves to, a tab a CTA opened by
  // service name says which entry answers for it, not the name of the link.
  const tabItems = useMemo<GuardTabStripItem[]>(
    () => openTabs.map((t) => ({ ...t, label: resolve(t.id)?.name ?? t.id, title: t.id, icon: Plug })),
    [openTabs, resolve],
  );

  if (loading && !view) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !view) {
    return (
      <EmptyState
        icon={Plug}
        title="Dependencies unavailable"
        body={error ?? 'The dependency catalog could not be read.'}
      />
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <CollapsibleAside label="Dependencies" defaultWidth={320}>
        <EntityList<GuardDependencyRow>
          label="Dependencies"
          items={rows}
          itemId={(d) => d.name}
          activeId={active?.name ?? null}
          onOpen={open}
          noun={{ one: 'dependency', many: 'dependencies' }}
          search={{
            placeholder: 'Search dependencies…',
            ariaLabel: 'Search dependencies',
            match: guardDependencyMatches,
          }}
          banner={<Warnings view={view} />}
          renderRow={(d) => <GuardDependencyListRow dependency={d} />}
          emptyText={
            view.detectionAvailable
              ? 'Nothing declared yet.'
              : 'Nothing has looked yet. Run `truecourse guard setup` to detect what this repo depends on.'
          }
        />
      </CollapsibleAside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* No Overview chip: with no dependency open this pane IS its no-selection
            state, the list beside it already carries the catalog. */}
        <GuardTabStrip
          tabs={tabItems}
          activeId={activeId}
          onSelect={(t) => open(t.id, t.pinned)}
          onClose={close}
        />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {active ? (
            <GuardDependencyDetail
              key={active.name}
              repoId={repoId}
              dependency={active}
              saving={saving}
              onSave={(patch) => save(active.name, patch)}
              {...(onOpenFlow ? { onOpenFlow } : {})}
            />
          ) : (
            <EmptyState icon={Plug} title="Select a dependency" body="Select a dependency." />
          )}
        </div>
      </div>
    </div>
  );
}

/** The row's CONTENT: what it is, how much rides on it, and whether it is there. */
export function GuardDependencyListRow({ dependency }: { dependency: GuardDependencyRow }) {
  const type = guardDependencyType(dependency);
  const state = dependency.state ? GUARD_DEPENDENCY_STATE[dependency.state] : null;
  const used = dependency.usedBy;
  return (
    <>
      <div className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-normal leading-snug text-foreground">
          {dependency.name}
        </span>
        {/* How much RIDES on it, beside what it IS. Muted, never a guard to-do
            colour: usage is a fact that does not change when the dependency is
            provided, and the state chip beside it already says what needs doing.
            Absent at zero, "used 0" is not news. */}
        {used > 0 && (
          <HoverPopover
            portal
            width="narrow"
            content={`${used} flow${used === 1 ? '' : 's'} rely on this, ${used === 1 ? 'it' : 'they'} contributed what it must provide, or ${used === 1 ? 'its' : 'their'} committed tests bind it.`}
          >
            <span className={`${CHIP} bg-muted text-foreground`}>Used {used}</span>
          </HoverPopover>
        )}
        {state && (
          <HoverPopover portal width="narrow" content={state.hint}>
            <span className={STATUS}>
              <span aria-hidden className={`${DOT} ${state.dot}`} />
              {state.label}
            </span>
          </HoverPopover>
        )}
      </div>
      <div className="flex w-full items-center gap-2">
        {type && (
          <HoverPopover portal width="wide" content={type.hint}>
            <span className={`${CHIP} bg-muted text-foreground`}>{type.label}</span>
          </HoverPopover>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {dependency.summary}
        </span>
      </div>
    </>
  );
}

/** What the page must say before the rows: broken files, orphan overlay entries. */
function Warnings({ view }: { view: GuardDependenciesView }) {
  const strips: { key: string; text: string }[] = [];
  if (view.invalidReason) strips.push({ key: 'invalid', text: view.invalidReason });
  if (view.unknownLocalNames.length > 0) {
    strips.push({
      key: 'unknown-local',
      text: `The local overlay carries entries the catalog never declares, so they are ignored: ${view.unknownLocalNames.join(', ')}.`,
    });
  }
  if (strips.length === 0) return null;
  return (
    <div className="space-y-2 border-b border-border p-2">
      {strips.map((s) => (
        <div
          key={s.key}
          className="flex items-start gap-2 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-[11px] text-sky-700 dark:text-sky-300"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{s.text}</span>
        </div>
      ))}
    </div>
  );
}
