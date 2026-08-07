/**
 * THE list surface. Every list in the dashboard — the flow inventory, the test
 * inventory, the journey catalog, a run's results, the corpus sidebar, the claims
 * a doc section states, a journey's commands — is this component configured, not
 * a list built again.
 *
 * What it owns, so no surface decides it twice:
 *
 *   SEARCH      one input, one placement (above the rows), one narrowing rule —
 *               the surface supplies the predicate, never the control. A surface
 *               whose rows come from a server-side query passes `value`/`onChange`
 *               and no predicate.
 *   FILTER      one idiom: count chips ({@link FilterBar}), single-select with
 *               toggle-off, multi-select where a surface needs it, and the
 *               typeahead shape above a dozen options. Never a `<select>`.
 *   GROUPING    optional, one nesting level deep, sticky headers, a count and an
 *               optional hover explainer per header, collapsible where a surface
 *               asks for it (the corpus sections, a run's passed group).
 *   ROWS        one interaction: single-click previews, double-click pins, Enter
 *               previews. The surface renders the row's CONTENT; the wrapper, the
 *               selected paint, the `role="listitem"` and the scroll-into-view of
 *               a deep-linked selection are this component's.
 *   STATES      loading, error, nothing-at-all and nothing-matches — one spelling
 *               each, wherever the list is.
 *
 * Hover help is {@link HoverPopover} everywhere, never the HTML `title`
 * attribute; the preview/pin rule is stated ONCE, on the row-count line, instead
 * of on every row.
 *
 * `variant="embedded"` drops the panel chrome (full height + own scroll) for a
 * list that lives inside something that already scrolls — a detail pane's
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
  /** The input's accessible name — what a test and a screen reader call it. */
  ariaLabel: string;
  /** Keeps an item when the query is non-empty. Omit when the source filters. */
  match?: (item: T, query: string) => boolean;
  /** Controlled value — for a search the surface runs against a server. */
  value?: string;
  onChange?: (query: string) => void;
}

export interface EntityListFilter<T> {
  /** The chip row's lead word — "Status", "Areas". */
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
  /** Hover explainer on the header label. */
  help?: ReactNode;
  /** A muted line under the header — why these rows are here. */
  hint?: ReactNode;
  icon?: LucideIcon;
  /** Header tint (a run's severity groups). */
  tone?: string;
  collapsible?: boolean;
  /** Initial state of a collapsible group, captured once at mount. */
  defaultOpen?: boolean;
  items?: readonly T[];
  /** One nesting level: a doc's sections, an area's docs. */
  groups?: EntityListGroup<T>[];
  /** Rendered under the group's rows — a "load more" control, say. */
  footer?: ReactNode;
  /**
   * Rows from their own source (a paged server query): the group renders this
   * node instead of items — itself an `EntityList variant="embedded"`, so the
   * idiom holds all the way down.
   */
  body?: ReactNode;
}

export interface EntityListProps<T> {
  /** The scrolling region's accessible name — "Flow inventory". */
  label: string;
  /** The rows, before search/filter/sort. Ignored when `groups` is given. */
  items?: readonly T[];
  /** Group the surviving items. Omit for one flat, header-less list. */
  group?: (items: T[]) => EntityListGroup<T>[];
  /** Pre-built groups — for a surface whose grouping is not a function of items. */
  groups?: EntityListGroup<T>[];
  itemId: (item: T) => string;
  /** The row's CONTENT; the wrapper, paint and interaction are the list's. */
  renderRow: (item: T) => ReactNode;
  /** Extra classes on a row wrapper — a muted ruling, a tinted gap. */
  rowClassName?: (item: T) => string | undefined;
  activeId?: string | null;
  /** Single-click previews (`pinned: false`), double-click pins. */
  onOpen?: (id: string, pinned: boolean) => void;
  /** Rows a click does nothing for — no pointer, no focus stop, no preview. */
  rowInteractive?: (item: T) => boolean;
  sort?: (a: T, b: T) => number;
  search?: EntityListSearch<T>;
  filter?: EntityListFilter<T>;
  /** The row-count line: "12 of 30 flows". Omit for no count line. */
  noun?: { one: string; many: string };
  /** A line above the controls — the PR baseline-fallback note. */
  banner?: ReactNode;
  loading?: boolean;
  error?: string | null;
  /**
   * Nothing at all, said quietly — for a PANEL whose main pane already carries
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

function groupItems<T>(group: EntityListGroup<T>): readonly T[] {
  return group.items ?? [];
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
      className={`${ROW} transition-colors ${open ? 'cursor-pointer' : ''} ${
        active ? 'bg-primary/10 text-foreground' : open ? 'hover:bg-muted/40' : ''
      } ${className ?? ''}`}
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
  const tone = group.tone ?? 'bg-card text-muted-foreground';
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
      {count != null && <span className="shrink-0 pl-2">{count}</span>}
    </>
  );
  const className = `${sticky} flex w-full items-center gap-1.5 border-b border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${tone}`;
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const selected = filter?.selected ?? [];
    let rows = all;
    if (filter && selected.length > 0) {
      rows = rows.filter((item) => selected.some((key) => filter.match(item, key)));
    }
    if (q && search?.match) rows = rows.filter((item) => search.match!(item, q));
    if (sort) rows = [...rows].sort(sort);
    return rows;
  }, [all, filter, search, query, sort]);

  const groups = useMemo<EntityListGroup<T>[]>(() => {
    if (fixedGroups) return fixedGroups;
    if (group) return group(visible);
    return [{ key: '', label: '', items: visible }];
  }, [fixedGroups, group, visible]);

  // A selection that arrived with the view (a deep link, a jump from another
  // surface) is off-screen in a long list — bring its row to the user. Keyed on
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

  const controls = (search || filter || noun) && (
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
      {filter && (
        <FilterBar
          label={filter.label}
          ariaLabel={filter.ariaLabel}
          options={filter.options}
          selected={filter.selected}
          onChange={filter.onChange}
          {...(filter.multi ? { multi: true } : {})}
        />
      )}
      {noun && (
        <div className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <HoverPopover portal width="narrow" content={onOpen ? PREVIEW_PIN_HINT : null}>
            <span>
              {visible.length} of {all.length} {all.length === 1 ? noun.one : noun.many}
            </span>
          </HoverPopover>
        </div>
      )}
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
        // Down only — every row is width-bound, so sideways scroll is never right.
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
