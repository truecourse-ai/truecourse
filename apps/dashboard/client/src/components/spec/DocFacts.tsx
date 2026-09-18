/**
 * What a document states ABOUT itself, above the document itself.
 *
 * A synced ticket opens with a YAML frontmatter block — when it was created,
 * when it last moved, when it resolved, the workflow state it sits in and the
 * transitions that got it there. The renderer hides that block (it is metadata,
 * not prose), so the facts are stated here instead, where a reader can see
 * where the ticket stands without reading YAML.
 *
 * A document that states none — every repository markdown page — renders
 * nothing at all and reads exactly as it always did.
 */

import type { ReactNode } from 'react';
import { formatRelativeTime, readDocFrontmatter, type StatusTransition } from '@truecourse/shared';
import { HoverPopover } from '@/dashboard/ui/hover-popover';

const LABEL = 'text-[11px] font-medium text-muted-foreground';
const VALUE = 'text-[11px] text-foreground';

/** The day of an instant, the grain a transition list reads at. */
const day = (iso: string): string => iso.slice(0, 10);

/** The instant in full, for the hover behind a relative time. */
const fullDate = (iso: string): string => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={LABEL}>{label}</span>
      <span className={VALUE}>{children}</span>
    </span>
  );
}

/** A stated date: how long ago, with the instant itself on hover. */
function DateFact({ label, iso }: { label: string; iso: string }) {
  return (
    <HoverPopover content={<span className="text-[11px]">{fullDate(iso)}</span>}>
      <Fact label={label}>{formatRelativeTime(iso)}</Fact>
    </HoverPopover>
  );
}

/** One transition: when, and what it moved between. The first has no `from`. */
function Transition({ at, from, to }: StatusTransition) {
  const cameFrom = from && from !== '(none)' ? from : null;
  return (
    <li className="flex items-baseline gap-2">
      <span className="tabular-nums text-muted-foreground">{at ? day(at) : ''}</span>
      <span className="text-foreground">{cameFrom ? `${cameFrom} → ${to}` : `→ ${to}`}</span>
    </li>
  );
}

export function DocFacts({ source }: { source: string }) {
  const facts = readDocFrontmatter(source);
  if (!facts) return null;

  const history = facts.statusHistory;
  const omitted = facts.omittedTransitions;

  return (
    <div className="mb-4 rounded border border-border bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {facts.status && (
          <HoverPopover
            content={
              facts.statusCategory ? (
                <span className="text-[11px]">Filed under {facts.statusCategory}</span>
              ) : null
            }
          >
            <Fact label="Status">{facts.status}</Fact>
          </HoverPopover>
        )}
        {facts.created && <DateFact label="Created" iso={facts.created} />}
        {facts.updated && <DateFact label="Updated" iso={facts.updated} />}
        {facts.resolved && <DateFact label="Resolved" iso={facts.resolved} />}
      </div>
      {(history.length > 0 || omitted > 0) && (
        <ol className="mt-2 space-y-0.5 text-[11px]">
          {omitted > 0 && (
            <li className="text-muted-foreground">… {omitted} earlier transitions</li>
          )}
          {history.map((t, i) => (
            <Transition key={i} {...t} />
          ))}
        </ol>
      )}
    </div>
  );
}
