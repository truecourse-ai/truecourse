/**
 * The flow's milestone chain — ONE component with TWO paint modes (see
 * `lib/guard-flow-paint.ts`): the Flows tab paints generate state (settled /
 * finding / drifted / awaiting / gap), the Runs tab paints a run as an INSTANCE of
 * its flow (pass up to the failure, fail at it, not-reached after, neutral when the
 * failure names no milestone).
 *
 * It renders in TWO parts, because a claim is a SENTENCE and a sentence does not
 * fit under a dot:
 *
 *   1. the STRIP — numbered circles and their connectors, paint only. No caption,
 *      so the whole chain reads at a glance whatever its length; the claim is in
 *      the node's hover.
 *   2. the LIST — one row per milestone, in the test-steps idiom: glyph · number ·
 *      the claim sentence · the section it binds to, as a jump into Coverage.
 *
 * Both halves read the SAME paint, so the strip and the list can never disagree.
 *
 * The component sizes to its content and clips nothing: it establishes no scroll
 * container of its own, so no milestone count grows an internal scrollbar and a
 * node's hover popover is never cut off at the chain's edge. The detail pane it
 * sits in owns the scrolling.
 */

import { ArrowUpRight } from 'lucide-react';
import { HoverPopover } from '@/components/ui/hover-popover';
import { GUARD_PAINT_META, type GuardMilestoneNode } from '@/lib/guard-flow-paint';

export function GuardMilestoneGraph({
  nodes,
  onSelectMilestone,
  callout,
  label = 'Milestones',
}: {
  nodes: GuardMilestoneNode[];
  /** Jump to a milestone's bound spec section; omitted = static nodes. */
  onSelectMilestone?: (node: GuardMilestoneNode) => void;
  /** Rendered between the strip and the list (the Runs tab's failure callout). */
  callout?: React.ReactNode;
  label?: string;
}) {
  if (nodes.length === 0) return null;

  // The legend names only the paints actually on screen, in node order.
  const paints = [...new Set(nodes.map((n) => n.paint))];

  return (
    <div>
      <div className="flex items-center" role="list" aria-label={label}>
        {nodes.map((node, i) => {
          const meta = GUARD_PAINT_META[node.paint];
          const incoming = i === 0 ? 'bg-transparent' : GUARD_PAINT_META[node.paint].line;
          const outgoing =
            i === nodes.length - 1 ? 'bg-transparent' : GUARD_PAINT_META[nodes[i + 1].paint].line;
          const jump = onSelectMilestone && node.doc && node.anchor;
          // The NUMBER goes in the circle: the row below carries the sentence, so
          // the strip only has to say "milestone N, and this is how it went".
          const circle = (
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 bg-card text-[11px] font-medium leading-none ${meta.node} ${meta.text}`}
            >
              {node.order}
            </span>
          );
          return (
            <div key={node.order} role="listitem" className="flex min-w-0 flex-1 items-center">
              <span className={`h-0.5 min-w-2 flex-1 ${incoming}`} />
              <HoverPopover portal
                width="narrow"
                content={`Milestone ${node.order} — ${node.title} · ${meta.label}${
                  node.headingText ? ` · § ${node.headingText}` : ''
                }`}
              >
                {jump ? (
                  <button
                    type="button"
                    onClick={() => onSelectMilestone!(node)}
                    aria-label={`Milestone ${node.order}: ${node.title} — ${meta.label}`}
                    className="rounded-full transition-transform hover:scale-110 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  >
                    {circle}
                  </button>
                ) : (
                  <span aria-label={`Milestone ${node.order}: ${node.title} — ${meta.label}`}>{circle}</span>
                )}
              </HoverPopover>
              <span className={`h-0.5 min-w-2 flex-1 ${outgoing}`} />
            </div>
          );
        })}
      </div>

      {callout}

      {/* The claims themselves — sentences in rows, not captions under dots. */}
      <ol className="mt-2 rounded border border-border" aria-label={`${label} list`}>
        {nodes.map((node) => {
          const meta = GUARD_PAINT_META[node.paint];
          const jump = onSelectMilestone && node.doc && node.anchor;
          return (
            <li
              key={node.order}
              className="flex min-w-0 items-start gap-2 border-b border-border/60 px-3 py-2 last:border-b-0"
            >
              <span className={`w-4 shrink-0 text-center text-[11px] ${meta.text}`} title={meta.label}>
                {meta.glyph}
              </span>
              <span className="w-4 shrink-0 text-[11px] text-muted-foreground">{node.order}</span>
              <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">{node.title}</span>
              {jump && (
                <button
                  type="button"
                  onClick={() => onSelectMilestone!(node)}
                  title={`${node.doc} § ${node.anchor}`}
                  className="inline-flex min-w-0 max-w-[45%] shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {/* Without `min-w-0` the label refuses to shrink and spills past the
                      button, widening the pane instead of ellipsising. */}
                  <span className="min-w-0 truncate">§ {node.headingText ?? node.anchor}</span>
                  <ArrowUpRight className="h-3 w-3 shrink-0" />
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {paints.map((p) => (
          <span key={p} className={`inline-flex items-center gap-1 ${GUARD_PAINT_META[p].text}`}>
            <span aria-hidden>{GUARD_PAINT_META[p].glyph}</span>
            {GUARD_PAINT_META[p].label}
          </span>
        ))}
      </div>
    </div>
  );
}
