/**
 * The needs-setup CALL TO ACTION, the one element that separates this state from
 * the grey "nobody can test this" wall: it says which third party is missing and
 * takes the user to the page that provides it. It wears the Blocked BLUE, because
 * that is exactly what it is: not yet, and you can move it. In the "setup done" sub-state the
 * account already exists, so the action is a COMMAND, not a link, the flows are
 * one `guard generate` away.
 *
 * ONE component, every surface that carries the state: the section side panel and
 * the flow detail's why-no-test row both render it, so a section and the flows
 * through it can never describe the same to-do with two sets of words. It leads
 * with the FULL sentence (`guardNeedsSetupHeadline`) rather than the compact
 * chip phrase, a banner has room to say what is actually going on.
 *
 * Each link carries the SERVICE it names, so it lands on that service's card
 * rather than the top of the Dependencies page, and a gap that names SEVERAL
 * outstanding services gets one link EACH, because a single combined link could
 * only ever open the first. The one synthetic key (`missing-data`) has no card
 * there, so it is never linked.
 */

import { ArrowUpRight } from 'lucide-react';
import type { GuardNeedsSetup } from '@truecourse/shared';
import { MISSING_DATA_NOUN, needsSetupIsDone } from '@truecourse/shared';
import {
  GUARD_NEEDS_SETUP_NEXT,
  GUARD_REGENERATE_ACTION,
  guardNeedsSetupCta,
  guardNeedsSetupHeadline,
  guardProvideServiceCta,
} from '@/lib/guard-flow-status';

/** One link: its words, and the service it lands on (none ⇒ the page itself). */
interface CtaLink {
  key: string;
  label: string;
  service?: string;
}

/**
 * ONE LINK PER OUTSTANDING SERVICE. A gap can name several ("apple and
 * googleapis") and a link opens exactly one card, so a single combined button
 * would leave every service but the first unreachable. The synthetic
 * `missing-data` key has no card and is never linked, when it is ALL a gap
 * names, the render branch below shows the extend-the-seed line instead of any
 * link, so this fallback only stands in for the degenerate empty case.
 */
function ctaLinks(needsSetup: GuardNeedsSetup): CtaLink[] {
  const linkable = needsSetup.services.filter((s) => s !== MISSING_DATA_NOUN);
  if (linkable.length === 0) {
    return [{ key: '__page__', label: guardNeedsSetupCta(needsSetup) }];
  }
  return linkable.map((service) => ({
    key: service,
    label: guardProvideServiceCta(service),
    service,
  }));
}

export function GuardNeedsSetupCta({
  needsSetup,
  onOpenExternals,
  explain = false,
  className = 'border-b border-border px-3 py-2',
}: {
  needsSetup: GuardNeedsSetup;
  /** Jump to the Dependencies tab, landing on this service's card when named. */
  onOpenExternals?: (service?: string) => void;
  /**
   * Also render the line the headline leaves out ({@link GUARD_NEEDS_SETUP_NEXT}) -
   * for the surfaces where this CTA is the whole read. The "setup done" sub-state
   * never shows it: it would tell the user to provide an account they already have.
   */
  explain?: boolean;
  /** The container's own paint, the side panel bands it, an inline row doesn't. */
  className?: string;
}) {
  const done = needsSetupIsDone(needsSetup);
  // The seed sub-state: the seed script exists and already fed the last generate,
  // so the action is EDITING it, a link to the Dependencies page (which has no
  // row for a seed) or the account explainer would both point somewhere wrong.
  const seedOnly =
    !done && needsSetup.services.length > 0 && needsSetup.services.every((s) => s === MISSING_DATA_NOUN);
  return (
    <div className={className}>
      <p className="text-[12px] leading-snug text-foreground">
        {guardNeedsSetupHeadline(needsSetup)}
      </p>
      {explain && !done && !seedOnly && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{GUARD_NEEDS_SETUP_NEXT}</p>
      )}
      {done ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {GUARD_REGENERATE_ACTION} authors them.
        </p>
      ) : seedOnly ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Extend the seed script to create it, then re-run {GUARD_REGENERATE_ACTION}.
        </p>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {ctaLinks(needsSetup).map((link) => (
            <button
              key={link.key}
              type="button"
              onClick={() => onOpenExternals?.(link.service)}
              disabled={!onOpenExternals}
              className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-background"
            >
              {link.label}
              <span className="text-muted-foreground">→ Dependencies</span>
              <ArrowUpRight className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
