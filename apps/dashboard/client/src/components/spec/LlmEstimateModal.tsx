/**
 * The pre-flight LLM cost-estimate confirm modal. Renders the identical numbers
 * the CLI prompt shows (staged: per-stage calls/model/cost table + subject +
 * ceiling cost; analyze: files/rules/tokens). Shared by every trigger that gates
 * on a cost estimate — the spec scan / analyze socket handshake AND the guard
 * Generate GET-estimate flow — so there is one modal, one set of numbers.
 */

import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { LlmEstimateData } from '@/hooks/useSocket';

interface LlmEstimateModalProps {
  estimate: LlmEstimateData;
  /** Proceed with the run. */
  onConfirm: () => void;
  /** Dismiss without running (overlay click / X / Cancel / Escape). */
  onCancel: () => void;
  /**
   * Optional per-source delta breakdown (the workspace combined-Process dialog):
   * one line per connected source whose pending work is folded into this run.
   * Absent for single-source estimates (spec scan / guard generate / one connector).
   */
  sources?: { name: string; summary: string }[];
}

export function LlmEstimateModal({ estimate: est, onConfirm, onCancel, sources }: LlmEstimateModalProps) {
  // Escape dismisses — the same affordance as the overlay click and the X.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const staged = !!est.stages && est.stages.length > 0;
  const tokensK = Math.round(est.totalEstimatedTokens / 1000);
  const totalCalls = staged ? est.stages!.reduce((s, x) => s + x.calls, 0) : 0;
  const fmtUsd = (usd: number) => (usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <span className="text-sm font-semibold text-foreground">
            {staged ? 'Proceed with this run?' : 'Run LLM rules?'}
          </span>
          <button
            onClick={onCancel}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {sources && sources.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-md border border-border/60 text-xs">
            {sources.map((s, i) => (
              <div
                key={s.name}
                className={`flex items-center justify-between gap-3 px-3 py-1.5 ${
                  i > 0 ? 'border-t border-border/40' : ''
                }`}
              >
                <span className="font-medium text-foreground">{s.name}</span>
                <span className="text-right text-muted-foreground">{s.summary}</span>
              </div>
            ))}
          </div>
        )}
        {staged ? (
          <div className="mb-5 text-xs text-muted-foreground">
            <p className="mb-3 leading-relaxed">
              {est.subjectLabel ? `${est.subjectLabel} · ` : ''}~{totalCalls} LLM calls · ~
              {tokensK}k tokens
              {est.estimatedCostUsd != null &&
                (est.expectedCostUsd != null ? (
                  <>
                    {' '}
                    · ~
                    <span className="font-semibold text-foreground">
                      {fmtUsd(est.expectedCostUsd)}
                      {est.costPartial ? '+' : ''}
                    </span>{' '}
                    expected · up to {fmtUsd(est.estimatedCostUsd)}
                    {est.costPartial ? '+' : ''}
                  </>
                ) : (
                  <>
                    {' '}
                    · up to{' '}
                    <span className="font-semibold text-foreground">
                      {fmtUsd(est.estimatedCostUsd)}
                      {est.costPartial ? '+' : ''}
                    </span>
                  </>
                ))}
            </p>
            <div className="overflow-hidden rounded-md border border-border/60">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-border/60 bg-muted/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                <span>Stage</span>
                <span className="text-right">Calls</span>
                <span className="text-right">Model</span>
                <span className="text-right">Cost</span>
              </div>
              {est.stages!.map((s, i) => (
                <div
                  key={s.stage}
                  className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-2 ${
                    i > 0 ? 'border-t border-border/40' : ''
                  }`}
                >
                  <span className="text-foreground">{s.label ?? s.stage}</span>
                  <span className="text-right tabular-nums">
                    {s.expectedCalls != null
                      ? `~${s.expectedCalls} (up to ${s.callsRange?.high ?? s.calls})`
                      : s.callsRange && s.callsRange.high !== s.calls
                        ? `${s.callsRange.low}–${s.callsRange.high}`
                        : s.calls}
                  </span>
                  <span className="text-right text-muted-foreground/70">{s.model}</span>
                  <span className="text-right tabular-nums text-foreground">
                    {s.expectedCostUsd != null && s.estimatedCostUsd != null
                      ? `~${fmtUsd(s.expectedCostUsd)} (max ${fmtUsd(s.estimatedCostUsd)})`
                      : s.estimatedCostUsd != null
                        ? fmtUsd(s.estimatedCostUsd)
                        : '—'}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 leading-relaxed text-[11px] text-muted-foreground/80">
              Ranges (e.g. 12–24) show fewest–most calls — the actual count depends on what the run
              finds.
              {est.estimatedCostUsd != null &&
                (est.costPartial ? (
                  <> Cost covers the priced stages only — unpriced stages may add more.</>
                ) : est.expectedCostUsd != null ? (
                  <>
                    {' '}
                    "Expected" is the likely spend; the max is a ceiling and prompt caching may lower
                    it{est.costSource === 'bundled' ? ' (prices approximate)' : ''}.
                  </>
                ) : (
                  <>
                    {' '}
                    Cost is a ceiling; prompt caching may lower it
                    {est.costSource === 'bundled' ? ' (prices approximate)' : ''}.
                  </>
                ))}
            </p>
          </div>
        ) : (
          <p className="mb-5 text-xs leading-relaxed text-muted-foreground">
            {(() => {
              const totalRules = est.tiers.reduce((s, t) => s + t.ruleCount, 0);
              const totalFiles = est.tiers.reduce((s, t) => s + t.fileCount, 0);
              return `${totalFiles} files, ${totalRules} rules (~${tokensK}k tokens).`;
            })()}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <button
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            onClick={onConfirm}
          >
            {staged ? 'Proceed' : 'Run LLM rules'}
          </button>
          <button
            className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent"
            onClick={onCancel}
          >
            {staged ? 'Cancel' : 'Skip — deterministic rules only'}
          </button>
        </div>
      </div>
    </div>
  );
}
