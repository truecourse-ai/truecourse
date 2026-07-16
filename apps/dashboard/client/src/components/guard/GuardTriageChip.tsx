/**
 * The triage-verdict chip — an Opus finding-triage verdict rendered inline beside a
 * finding (its detail header and the coverage section-detail rows). Colour follows
 * the meaning: the two REAL-drift verdicts are tinted (code-drift red like a bug,
 * doc-drift amber like a doc fix), the two NOISE verdicts (generation-defect,
 * environment) stay muted — the verdict is advisory, so it never mimics a solid run
 * pill. Same outlined geometry as GuardFindingBadge so it sits inline with it.
 */

import type { GuardTriageVerdict } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';

const VERDICT_META: Record<GuardTriageVerdict, { label: string; cls: string; help: string }> = {
  'doc-drift': {
    label: 'doc drift',
    cls: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
    help: "The doc is wrong — the program's real behavior is fine. The recommendation quotes the exact doc line to change.",
  },
  'code-drift': {
    label: 'code drift',
    cls: 'border-red-500/40 text-red-600 dark:text-red-400',
    help: 'The code is wrong — it violates the documented promise. A real bug this finding caught.',
  },
  'generation-defect': {
    label: 'gen defect',
    cls: 'border-border text-muted-foreground',
    help: "The scenario itself is faulty — the doc and code don't actually disagree. Dismiss it, or fix the section and re-generate.",
  },
  environment: {
    label: 'environment',
    cls: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
    help: 'A sandbox/run artefact, not a doc-vs-code disagreement. Dismiss it, or re-generate.',
  },
};

export function GuardTriageChip({
  verdict,
  compact = false,
  className = '',
}: {
  verdict: GuardTriageVerdict;
  compact?: boolean;
  className?: string;
}) {
  const meta = VERDICT_META[verdict];
  return (
    <HoverPopover content={meta.help}>
      <span
        className={`inline-flex shrink-0 items-center rounded border ${compact ? 'px-1 py-0 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'} font-medium uppercase tracking-wider ${meta.cls} ${className}`}
      >
        {meta.label}
      </span>
    </HoverPopover>
  );
}
