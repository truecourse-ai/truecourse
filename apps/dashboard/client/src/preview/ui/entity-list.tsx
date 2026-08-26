/**
 * THE list surface. Every list in the dashboard (the flow inventory, the test
 * inventory, the interface catalog, a run's results, the corpus sidebar, the claims
 * a doc section states, an interface's commands) is this component configured, not
 * a list built again.
 *
 * What it owns, so no surface decides it twice:
 *
 *   SEARCH      one input, one placement (above the rows), one narrowing rule,
 *               the surface supplies the predicate, never the control. A surface
 *               whose rows come from a server-side query passes `value`/`onChange`
 *               and no predicate.
 *   FILTER      one idiom: count chips ({@link FilterBar}), single-select with
 *               toggle-off, multi-select where a surface needs it, and the
 *               typeahead shape above a dozen options. Never a `<select>`. A
 *               surface with two independent questions (the Tests list's status
 *               AND its drivers) passes an ARRAY of bars, same chips, and a row
 *               must satisfy every bar that has a selection.
 *   GROUPING    optional, one nesting level deep, sticky headers, a count and an
 *               optional hover explainer per header, collapsible where a surface
 *               asks for it (the corpus sections, a run's passed group). A nested
 *               group reads as the inner level where it says so (`subordinate`).
 *   ROWS        one interaction: single-click previews, double-click pins, Enter
 *               previews. The surface renders the row's CONTENT; the wrapper, the
 *               selected paint, the `role="listitem"` and the scroll-into-view of
 *               a deep-linked selection are this component's.
 *   STATES      loading, error, nothing-at-all and nothing-matches, one spelling
 *               each, wherever the list is.
 *
 * Hover help is {@link HoverPopover} everywhere, never the HTML `title`
 * attribute; the preview/pin rule is stated ONCE, on the row-count line, instead
 * of on every row.
 *
 * `variant="embedded"` drops the panel chrome (full height + own scroll) for a
 * list that lives inside something that already scrolls, a detail pane's
 * section, or a group of an outer list whose rows load from their own source.
 */

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Loader2, type LucideIcon } from 'lucide-react';
import { useScrollToSelected } from '@/hooks/useScrollToSelected';
import { FilterBar, type FilterOption } from './filter-bar';
import { HoverPopover } from './hover-popover';

export type { FilterOption };

/** The house rule, said once per list instead of once per row. */
export const PREVIEW_PIN_HINT = 'Click a row to preview it, double-click to pin it open.';

export interface EntityListSearch<T> {
  placeholder: string;
  /** The input's accessible name: what a test and a screen reader call it. */
  ariaLabel: string;
  /** Keeps an item when the query is non-empty. Omit when the source filters. */
  match?: (item: T, query: string) => boolean;
  /** Controlled value: for a search the surface runs against a server. */
  value?: string;
  onChange?: (query: string) => void;
}

export interface EntityListFilter<T> {
  /** The chip row's lead word: "Status", "Areas". */
  label: string;
  ariaLabel: string;
  options: FilterOption[];
  /** Selected keys; empty = no narrowing. */
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /** Keeps an item for one selected key (OR across keys in multi mode). */
  match: (item: T, key: string) => boolean;
  multi?: boolean;
}

export interface EntityListGroup<T> {
  key: string;
  /** The header's text. */
  label: ReactNode;
  /**
   * The group in plain words, for a collapsible header's accessible name
   * ("Expand passed tests"). Defaults to the label when it is a string.
   */
  name?: string;
  /** Shown at the header's right edge. Omit for a header with no tally. */
  count?: number;
  /**
   * What the header's tally READS as, when the plain row count would understate
   * the group: "12/757" for a group whose rows split into open and settled.
   * Display only: {@link count} still carries the number the nesting sums and the
   * shape memo keys on, so a group that sets this must set `count` too.
   */
  countLabel?: string;
  /** Hover explainer on the header label. */
  help?: ReactNode;
  /** A muted line under the header: why these rows are here. */
  hint?: ReactNode;
  /**
   * Rows at the group's TOP, above its items and nested groups, rows that belong
   * to the group rather than to any entity in it (the Interfaces catalog's recipe
   * rows, which open a surface's preparation). Wear {@link entityRowClass}, so
   * they read as the list's own rows; never a second narrowing control.
   */
  lead?: ReactNode;
  icon?: LucideIcon;
  /** Header tint (a run's severity groups). */
  tone?: string;
  /**
   * The INNER level of a nesting, said in chrome: the same header one step
   * quieter: lighter weight, a hairline rule, its label indented under the
   * level above (a surface's families). Omit for the full-weight header every
   * outer group wears.
   */
  subordinate?: boolean;
  collapsible?: boolean;
  /** Initial state of a collapsible group, captured once at mount. */
  defaultOpen?: boolean;
  items?: readonly T[];
  /** One nesting level: a doc's sections, an area's docs. */
  groups?: EntityListGroup<T>[];
  /** Rendered under the group's rows, a "load more" control, say. */
  footer?: ReactNode;
  /**
   * Rows from their own source (a paged server query): the group renders this
   * node instead of items: itself an `EntityList variant="embedded"`, so the
   * idiom holds all the way down.
   */
  body?: ReactNode;
}

export interface EntityListProps<T> {
  /** The scrolling region's accessible name, "Flow inventory". */
  label: string;
  /** The rows, before search/filter/sort. Ignored when `groups` is given. */
  items?: readonly T[];
  /** Group the surviving items. Omit for one flat, header-less list. */
  group?: (items: T[]) => EntityListGroup<T>[];
  /** Pre-built groups: for a surface whose grouping is not a function of items. */
  groups?: EntityListGroup<T>[];
  itemId: (item: T) => string;
  /** The row's CONTENT; the wrapper, paint and interaction are the list's. */
  renderRow: (item: T) => ReactNode;
  /** Extra classes on a row wrapper: a muted ruling, a tinted gap. */
  rowClassName?: (item: T) => string | undefined;
  activeId?: string | null;
  /** Single-click previews (`pinned: false`), double-click pins. */
  onOpen?: (id: string, pinned: boolean) => void;
  /** Rows a click does nothing for: no pointer, no focus stop, no preview. */
  rowInteractive?: (item: T) => boolean;
  sort?: (a: T, b: T) => number;
  search?: EntityListSearch<T>;
  /**
   * The narrowing chips. One bar is the common case; a surface asking two
   * independent questions passes both, and a row must satisfy EVERY bar that has
   * a selection (AND across bars, OR inside one).
   */
  filter?: EntityListFilter<T> | EntityListFilter<T>[];
  /** The row-count line: "12 of 30 flows". Omit for no count line. */
  noun?: { one: string; many: string };
  /** A line above the controls: the PR baseline-fallback note. */
  banner?: ReactNode;
  /**
   * A compact affordance UNDER the controls, above the rows, a surface-level
   * opener that belongs to the list rather than to any one row (the Flows list's
   * Recipe button). Never a second narrowing control: search and the filter chips
   * are this component's, and nothing else may narrow the same rows.
   */
  toolbar?: ReactNode;
  loading?: boolean;
  error?: string | null;
  /**
   * Nothing at all, said quietly: for a PANEL whose main pane already carries
   * the one {@link EmptyState} CTA, so two cards never sit side by side.
   */
  emptyText?: string;
  /** Shown when data exists but the search/filter keeps none. */
  noMatch?: ReactNode;
  /** `panel` (own height + scroll) or `embedded` (the parent scrolls). */
  variant?: 'panel' | 'embedded';
}

const SEARCH_INPUT =
  'w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

const ROW = 'flex w-full min-w-0 flex-col items-start gap-1 border-b border-border/60 px-3 py-2 text-left';

/**
 * THE row idiom: the wrapper, the selected paint and the hover of one line in a
 * list. Exported because a surface-level row that is not an item still has to BE
 * a row (the Interfaces catalog's recipe rows, which open a preparation rather
 * than an entity): they wear this, not a look of their own, and a row can never
 * drift from the rows above it.
 */
export function entityRowClass(opts?: { active?: boolean; interactive?: boolean }): string {
  const active = opts?.active === true;
  const interactive = opts?.interactive !== false;
  return `${ROW} transition-colors ${interactive ? 'cursor-pointer' : ''} ${
    active ? 'bg-primary/10 text-foreground' : interactive ? 'hover:bg-muted/40' : ''
  }`;
}

function groupItems<T>(group: EntityListGroup<T>): readonly T[] {
  return group.items ?? [];
}

/** The filter bars a surface configured, in render order (none, one, or several). */
function filterBars<T>(filter: EntityListProps<T>['filter']): EntityListFilter<T>[] {
  if (!filter) return [];
  return Array.isArray(filter) ? filter : [filter];
}

function countOf<T>(group: EntityListGroup<T>): number | undefined {
  if (group.count != null) return group.count;
  if (group.groups) return group.groups.reduce((n, g) => n + (countOf(g) ?? 0), 0);
  return group.items?.length;
}

/** Does this group (or anything under it) have a row to show? */
function groupHasRows<T>(group: EntityListGroup<T>): boolean {
  if (group.body || group.footer) return true;
  if (groupItems(group).length > 0) return true;
  return (group.groups ?? []).some(groupHasRows);
}

function Row<T>({
  item,
  id,
  active,
  interactive,
  className,
  onOpen,
  renderRow,
  rowRef,
}: {
  item: T;
  id: string;
  active: boolean;
  interactive: boolean;
  className: string | undefined;
  onOpen: ((id: string, pinned: boolean) => void) | undefined;
  renderRow: (item: T) => ReactNode;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const open = interactive && onOpen ? onOpen : undefined;
  return (
    <div
      ref={rowRef}
      role="listitem"
      {...(open
        ? {
            tabIndex: 0,
            onClick: () => open(id, false),
            onDoubleClick: () => open(id, true),
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              open(id, false);
            },
          }
        : {})}
      aria-current={active ? 'true' : undefined}
      className={`${entityRowClass({ active, interactive: !!open })}${className ? ` ${className}` : ''}`}
    >
      {renderRow(item)}
    </div>
  );
}

function GroupHeader<T>({ group, depth, open, onToggle }: {
  group: EntityListGroup<T>;
  depth: number;
  open: boolean;
  onToggle: (() => void) | undefined;
}) {
  const Icon = group.icon;
  const count = countOf(group);
  // Depth 0 parks at the top; a nested header parks directly under it.
  const sticky = depth === 0 ? 'sticky top-0 z-20' : 'sticky top-6 z-10';
  // A subordinate header is the SAME header, one step down: lighter weight, a
  // hairline rule and the label indented, so the level it heads is legible at a
  // glance. It stays opaque: it sticks, and rows must not read through it.
  const level = group.subordinate ? 'border-border/60 font-medium' : 'border-border font-semibold';
  const tone =
    group.tone ?? (group.subordinate ? 'bg-card text-muted-foreground/80' : 'bg-card text-muted-foreground');
  const body = (
    <>
      {onToggle &&
        (open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        ))}
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      <span className="flex min-w-0 flex-1 text-left">
        {group.help ? (
          <HoverPopover portal width="wide" content={group.help}>
            <span className="min-w-0 truncate underline decoration-dotted underline-offset-2">{group.label}</span>
          </HoverPopover>
        ) : (
          <span className="min-w-0 truncate">{group.label}</span>
        )}
      </span>
      {count != null && <span className="shrink-0 pl-2">{group.countLabel ?? count}</span>}
    </>
  );
  const className = `${sticky} flex w-full items-center gap-1.5 border-b px-3 py-1 text-[10px] uppercase tracking-wider ${level} ${tone}`;
  const name = group.name ?? (typeof group.label === 'string' ? group.label : undefined);
  return (
    <>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          {...(name ? { 'aria-label': `${open ? 'Collapse' : 'Expand'} ${name}` } : {})}
          className={`${className} hover:text-foreground`}
        >
          {body}
        </button>
      ) : (
        <div className={className}>{body}</div>
      )}
      {open && group.hint && (
        <div className="border-b border-border/60 bg-muted/30 px-3 py-1 text-[10px] leading-snug text-muted-foreground">
          {group.hint}
        </div>
      )}
    </>
  );
}

function Group<T>({
  group,
  depth,
  rest,
}: {
  group: EntityListGroup<T>;
  depth: number;
  rest: EntityListProps<T> & { rowRefs: { set: (id: string) => (el: HTMLDivElement | null) => void } };
}) {
  const [open, setOpen] = useState(group.defaultOpen ?? true);
  const collapsible = group.collapsible === true;
  const shown = collapsible ? open : true;
  const rows = groupItems(group);
  const headless = group.key === '' && group.label === '';

  return (
    <div>
      {!headless && (
        <GroupHeader
          group={group}
          depth={depth}
          open={shown}
          onToggle={collapsible ? () => setOpen((v) => !v) : undefined}
        />
      )}
      {shown && (
        <>
          {group.lead}
          {group.groups?.map((child) => (
            <Group key={child.key} group={child} depth={depth + 1} rest={rest} />
          ))}
          {group.body}
          {rows.map((item) => {
            const id = rest.itemId(item);
            return (
              <Row
                key={id}
                item={item}
                id={id}
                active={rest.activeId === id}
                interactive={rest.rowInteractive ? rest.rowInteractive(item) : true}
                className={rest.rowClassName?.(item)}
                onOpen={rest.onOpen}
                renderRow={rest.renderRow}
                rowRef={rest.rowRefs.set(id)}
              />
            );
          })}
          {group.footer}
        </>
      )}
    </div>
  );
}

export function EntityList<T>(props: EntityListProps<T>) {
  const {
    label,
    items,
    group,
    groups: fixedGroups,
    search,
    filter,
    sort,
    noun,
    banner,
    toolbar,
    loading = false,
    error = null,
    emptyText,
    noMatch,
    variant = 'panel',
    activeId = null,
    onOpen,
  } = props;

  const [ownQuery, setOwnQuery] = useState('');
  const query = search?.value ?? ownQuery;
  const setQuery = (next: string) => {
    if (search?.onChange) search.onChange(next);
    else setOwnQuery(next);
  };

  const all = useMemo(() => (items ? [...items] : []), [items]);

  const bars = useMemo(() => filterBars(filter), [filter]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = all;
    // Every bar that has a selection narrows in turn: a row must answer all of
    // them (and any of the keys inside one), so two bars read as two questions.
    for (const bar of bars) {
      if (bar.selected.length === 0) continue;
      rows = rows.filter((item) => bar.selected.some((key) => bar.match(item, key)));
    }
    if (q && search?.match) rows = rows.filter((item) => search.match!(item, q));
    if (sort) rows = [...rows].sort(sort);
    return rows;
  }, [all, bars, search, query, sort]);

  const groups = useMemo<EntityListGroup<T>[]>(() => {
    if (fixedGroups) return fixedGroups;
    if (group) return group(visible);
    return [{ key: '', label: '', items: visible }];
  }, [fixedGroups, group, visible]);

  // A selection that arrived with the view (a deep link, a jump from another
  // surface) is off-screen in a long list, bring its row to the user. Keyed on
  // the list's SHAPE, not the groups array's identity: a surface that rebuilds
  // its groups each render must not re-scroll on every render.
  const shape = useMemo(() => groups.map((g) => `${g.key}:${countOf(g) ?? 0}`).join('|'), [groups]);
  const rowRefs = useScrollToSelected<HTMLDivElement>(activeId, [shape]);

  const hasAnything = fixedGroups ? fixedGroups.some(groupHasRows) : all.length > 0;
  const hasVisible = groups.some(groupHasRows);

  const shell = (children: ReactNode) =>
    variant === 'panel' ? (
      <div className="flex h-full flex-col overflow-hidden">{children}</div>
    ) : (
      <div className="flex min-w-0 flex-col">{children}</div>
    );

  if (loading && !hasAnything) {
    return shell(
      <div className="flex h-full items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>,
    );
  }
  if (error && !hasAnything) {
    return shell(
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <span>{error}</span>
      </div>,
    );
  }
  if (!hasAnything) {
    return shell(
      <div className="flex h-full items-center justify-center px-4 py-6">
        <p className="text-center text-xs text-muted-foreground">{emptyText ?? 'Nothing here yet.'}</p>
      </div>,
    );
  }

  const controls = (search || bars.length > 0 || noun || toolbar) && (
    <div className="shrink-0">
      {search && (
        <div className="border-b border-border p-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.ariaLabel}
            className={SEARCH_INPUT}
          />
        </div>
      )}
      {bars.map((bar) => (
        <FilterBar
          key={bar.ariaLabel}
          label={bar.label}
          ariaLabel={bar.ariaLabel}
          options={bar.options}
          selected={bar.selected}
          onChange={bar.onChange}
          {...(bar.multi ? { multi: true } : {})}
        />
      ))}
      {/* The count line only carries information while a search or filter narrows the list. */}
      {noun && visible.length !== all.length && (
        <div className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <HoverPopover portal width="narrow" content={onOpen ? PREVIEW_PIN_HINT : null}>
            <span>
              {visible.length} of {all.length} {all.length === 1 ? noun.one : noun.many}
            </span>
          </HoverPopover>
        </div>
      )}
      {toolbar && <div className="border-b border-border px-2 py-1.5">{toolbar}</div>}
    </div>
  );

  const rest = { ...props, rowRefs };

  return shell(
    <>
      {banner}
      {controls}
      {!hasVisible ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          {noMatch ?? 'Nothing matches these filters.'}
        </div>
      ) : (
        // Down only: every row is width-bound, so sideways scroll is never right.
        <div
          className={
            variant === 'panel'
              ? 'min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden'
              : 'min-w-0'
          }
          role="list"
          aria-label={label}
        >
          {groups.map((g) => (
            <Group key={g.key} group={g} depth={0} rest={rest} />
          ))}
        </div>
      )}
    </>,
  );
}
