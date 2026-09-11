/**
 * The small shared pieces every screen reaches for: the provider mark, the
 * neutral capsule, the pin mark a pinned detail wears, a detail pane's header
 * and its footer facts, and the preview/pin selection hook the panels share.
 *
 * They live together because each is three lines and none of them is a
 * decision: the decisions are in {@link StatusWord} (a status is a dot plus a
 * word) and in the copied `entity-list` (a row previews on click and pins on
 * double-click). This file only keeps a surface from spelling either one twice.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Pin } from 'lucide-react';
import type { ProviderId } from '@/preview/data/types';
import azure from './logos/azure.svg';
import github from './logos/github.svg';
import gitlab from './logos/gitlab.svg';

/** The providers' own marks (the SVG Logos and Devicon sets, CC0/MIT), as image files. */
const PROVIDER_LOGO: Record<ProviderId, string> = { github, gitlab, azure };

export const PROVIDER_NAME: Record<ProviderId, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  azure: 'Azure DevOps',
};

export function ProviderIcon({ provider, className = 'h-3.5 w-3.5' }: { provider: ProviderId; className?: string }) {
  return (
    <img
      src={PROVIDER_LOGO[provider]}
      alt={PROVIDER_NAME[provider]}
      className={`${className} shrink-0 object-contain`}
    />
  );
}

/** A neutral bounded label. Never a status: those are dot plus word. */
/** THE chip: a neutral bounded label on the muted ground, foreground ink, 10px. Never a status. */
export const CHIP_CLASS = 'inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground';

export function Capsule({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`${CHIP_CLASS} ${className}`}>{children}</span>;
}

/** The mark a pinned detail wears in its header, so a pin is visible, not remembered. */
export function PinMark() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
      <Pin className="h-3 w-3" aria-hidden />
      pinned
    </span>
  );
}

/** A detail pane's top line: what is on screen, and whether it was pinned there. */
export function DetailHeader({
  title,
  subtitle,
  pinned = false,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  pinned?: boolean;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{title}</h2>
          {pinned && <PinMark />}
        </div>
        {subtitle && <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/** Footer facts: one per line, label left, value right, no table. */
export function Facts({
  rows,
  /** The list's own classes: a border when nothing around it draws one. */
  className = '',
  /** The rows' horizontal inset: `px-4` inside a box, `px-6` flush with a pane. */
  rowClassName = 'px-4',
}: {
  rows: readonly { label: string; value: ReactNode }[];
  className?: string;
  rowClassName?: string;
}) {
  return (
    <dl className={`divide-y divide-border/60 ${className}`}>
      {rows.map((r) => (
        <div key={r.label} className={`flex items-baseline gap-4 py-1.5 text-xs ${rowClassName}`}>
          <dt className="w-44 shrink-0 text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 flex-1 break-words text-foreground">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A named block inside a one-column detail. */
export function DetailSection({
  title,
  right,
  children,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * The preview/pin pair every panel keeps: one previewed row, a set of pinned
 * ones. Pinning is session state and shows as a mark on the detail's header;
 * it never survives a reload, because nothing in the preview does.
 */
export function usePreviewSelection(initialId: string | null) {
  const [activeId, setActiveId] = useState<string | null>(initialId);
  const [pinnedIds, setPinnedIds] = useState<readonly string[]>([]);

  const open = useCallback((id: string, pinned: boolean) => {
    setActiveId(id);
    if (pinned) setPinnedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const isPinned = useCallback((id: string | null) => (id ? pinnedIds.includes(id) : false), [pinnedIds]);

  return { activeId, setActiveId, open, isPinned };
}

/** One step of the trail before a page's title: a link, with an optional mark before its words. */
export interface Crumb {
  label: ReactNode;
  to: string;
  icon?: ReactNode;
}

/**
 * THE page header: one row, never a second. The trail (`crumbs`) walks from the
 * page's own section to the title, never from the workspace; the title is the
 * page's name; a muted subtitle and the page's actions sit to the right. Every
 * top-level page, the repository console and every page opened from a list
 * wear it, so a page never looks like a different product from the page
 * beside it.
 */
export function PageHeader({
  title,
  crumbs = [],
  icon,
  subtitle,
  right,
}: {
  title: ReactNode;
  /** The trail before the title, outermost first. */
  crumbs?: readonly Crumb[];
  /** A mark before the title itself (a provider's logo before a repository). */
  icon?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  const heading = (
    <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">
      {icon}
      {title}
    </h1>
  );
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
      {crumbs.length === 0 ? (
        heading
      ) : (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          {crumbs.map((crumb, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1.5">
              <Link to={crumb.to} className="flex items-center gap-1.5 font-semibold text-foreground hover:underline">
                {crumb.icon}
                {crumb.label}
              </Link>
              <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </span>
          ))}
          {heading}
        </nav>
      )}
      {subtitle && <span className="shrink-0 text-xs text-muted-foreground">{subtitle}</span>}
      {right && <span className="ml-auto flex shrink-0 items-center gap-3">{right}</span>}
    </header>
  );
}

/** The section title inside a page body: small, left-aligned, no hero. */
export function SectionTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-xs font-semibold uppercase tracking-wider text-muted-foreground ${className}`}>{children}</h2>;
}

/**
 * THE left menu of a page that has sections (the repository console, Settings):
 * a narrow column of links, the active one painted, the section in the URL.
 */
export interface SideMenuItem {
  id: string;
  label: string;
  to: string;
}

export interface SideMenuGroup {
  /** The group's caption above its links; omit for the unlabeled first group. */
  label?: string;
  items: readonly SideMenuItem[];
}

export function SideMenu({
  label,
  items,
  groups,
  activeId,
}: {
  label: string;
  /** One flat list of links, or … */
  items?: readonly SideMenuItem[];
  /** … several groups, each with an optional caption. */
  groups?: readonly SideMenuGroup[];
  activeId: string;
}) {
  const sections: readonly SideMenuGroup[] = groups ?? [{ items: items ?? [] }];
  return (
    <nav aria-label={label} className="w-44 shrink-0 overflow-y-auto border-r border-border bg-card/40 px-2 py-3">
      {sections.map((group, i) => (
        <div key={group.label ?? i} className={i > 0 ? 'mt-5' : ''}>
          {group.label && (
            <div className="px-2.5 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">{group.label}</div>
          )}
          <div className="space-y-0.5">
            {group.items.map((t) => (
              <Link
                key={t.id}
                to={t.to}
                aria-current={activeId === t.id ? 'page' : undefined}
                className={`block rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  activeId === t.id
                    ? 'bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
