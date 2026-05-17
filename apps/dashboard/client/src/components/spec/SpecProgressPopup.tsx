/**
 * Spec progress popup. Same visual pattern as the Analyze progress
 * popup — bottom-center, list of checkable steps streamed in via the
 * `spec:progress` Socket.io event.
 */

import { Check, CircleX, Loader2, X } from 'lucide-react';
import type { AnalysisProgress } from '@/hooks/useSocket';

interface SpecProgressPopupProps {
  progress: AnalysisProgress;
  onDismiss: () => void;
}

export function SpecProgressPopup({ progress, onDismiss }: SpecProgressPopupProps) {
  const isError = progress.step === 'error';
  return (
    <div
      className={`fixed bottom-4 left-1/2 z-40 w-80 -translate-x-1/2 rounded-lg border bg-card p-3 shadow-lg ${
        isError ? 'border-destructive/50' : 'border-border'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`text-[11px] font-medium ${
            isError ? 'text-destructive' : 'text-foreground'
          }`}
        >
          {isError ? 'Spec failed' : 'Running…'}
        </span>
        {isError && (
          <button
            onClick={onDismiss}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {isError ? (
        <div className="flex items-start gap-2">
          <CircleX className="h-3.5 w-3.5 shrink-0 translate-y-px text-destructive" />
          <span className="text-[11px] text-muted-foreground">
            {progress.detail || 'An error occurred'}
          </span>
        </div>
      ) : progress.steps && progress.steps.length > 0 ? (
        <div className="space-y-1">
          {progress.steps.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className="shrink-0 translate-y-px">
                {s.status === 'done' && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                {s.status === 'active' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                {s.status === 'error' && <CircleX className="h-3.5 w-3.5 text-destructive" />}
                {s.status === 'pending' && (
                  <div className="h-2.5 w-2.5 rounded-full border border-muted-foreground/30" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span
                  className={`text-[11px] leading-[18px] ${
                    s.status === 'active'
                      ? 'font-medium text-foreground'
                      : s.status === 'done'
                        ? 'text-muted-foreground'
                        : s.status === 'error'
                          ? 'text-destructive'
                          : 'text-muted-foreground/60'
                  }`}
                >
                  {s.label}
                  {s.detail && s.status !== 'pending' && (
                    <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/70">
                      {s.detail}
                    </span>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          <span className="text-[11px] text-muted-foreground">
            {progress.detail || progress.step}
          </span>
        </div>
      )}
    </div>
  );
}
