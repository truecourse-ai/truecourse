/**
 * A flow's PLAYWRIGHT TEST, as the flow detail's body: the same reading the
 * scenario workspace gives a YAML scenario ({@link GuardScenarioBody}), for the
 * flows a test proves.
 *
 *   verdict     the word, how long the run took, how the steps went; for a
 *               failing test, what the documents say against what the product
 *               did; for a blocked flow, what it waits on
 *   filmstrip   a browser run only: the session video as the Replay tile, then
 *               one tile per step, the failing one marked
 *   the steps   the spec's own `test.step`s as one dense collapsible line each,
 *               green or red, with the seed as row zero: it is the state step 1
 *               starts in. An opened step shows what its assertion said and the
 *               picture of the page as the step ended; the failing one starts open
 *   the record  the summary its session gave, collapsible; the rulings stand open
 *   footer      the spec and the seed, by file
 *
 * The run shown is the one the test's status was accepted on. A test stored
 * without one says so and shows its files.
 *
 * The other reading, on the header's mode switch, is the files themselves: the
 * spec, then its seed.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, ScrollText } from "lucide-react";
import type { FlowTestStep, GuardEvidenceVisual, GuardFlowTestView } from "@truecourse/shared";
import { ArtifactRaw } from "@/dashboard/ui/artifact-view";
import * as api from "@/lib/api";
import { formatGuardDuration } from "@/lib/guard-drifts";
import {
  GuardRunFilmstrip,
  GuardScreenshotLightbox,
  GuardStepScreenshot,
} from "@/components/guard/GuardEvidenceVisuals";
import { GuardLongText } from "@/components/guard/GuardLongText";
import { PRE } from "@/components/guard/detail-styles";

const LABEL = "mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground";
const STEP_ROW =
  "flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 px-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

/** The seed's place in the step list: the state step 1 starts in. */
const SEED_STEP = 0;

const VERDICT: Record<GuardFlowTestView["status"], { word: string; dot: string; border: string }> = {
  passing: { word: "Passing", dot: "bg-emerald-500", border: "border-emerald-500/35" },
  failing: { word: "Failing", dot: "bg-red-500", border: "border-red-500/35" },
  blocked: { word: "Blocked", dot: "bg-amber-500", border: "border-amber-500/35" },
};

const STEP_DOT: Record<FlowTestStep["outcome"], string> = {
  passed: "bg-emerald-500",
  failed: "bg-red-500",
  "not-reached": "bg-slate-400",
};

/** Painted as an inset shadow, like the scenario view's: only where a verdict landed. */
const STEP_BAND: Record<FlowTestStep["outcome"], string> = {
  passed: "shadow-[inset_2px_0_0_0_#10b981]",
  failed: "shadow-[inset_2px_0_0_0_#ef4444]",
  "not-reached": "",
};

const STEP_WORD: Record<FlowTestStep["outcome"], string> = {
  passed: "passed",
  failed: "failed",
  "not-reached": "not reached",
};

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      aria-hidden
      className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
    />
  );
}

export function GuardFlowTestBody({
  repoId,
  test,
  raw = false,
  rulings,
}: {
  repoId: string;
  test: GuardFlowTestView;
  /** The parent's artifact mode: true renders the stored files instead of the page. */
  raw?: boolean;
  /** The rulings a reader can make about this flow, after the evidence. */
  rulings?: ReactNode;
}) {
  const run = test.run;
  const steps = run?.steps ?? [];
  const failed = steps.find((step) => step.outcome === "failed");
  const evidencePath = run?.evidencePath;
  const where = useMemo<api.GuardEvidenceWhere | null>(
    () => (evidencePath ? { evidencePath } : null),
    [evidencePath],
  );

  const [visuals, setVisuals] = useState<GuardEvidenceVisual[]>([]);
  useEffect(() => {
    setVisuals([]);
    if (!where) return;
    let alive = true;
    api
      .getGuardEvidenceVisuals(repoId, where)
      .then((found) => {
        if (alive) setVisuals(found);
      })
      .catch(() => {
        /* no pictures is how a run without a browser reads too */
      });
    return () => {
      alive = false;
    };
  }, [repoId, where]);
  const screenshots = useMemo(() => visuals.filter((v) => v.kind === "screenshot"), [visuals]);
  const videos = useMemo(() => visuals.filter((v) => v.kind === "video"), [visuals]);

  /** The steps whose records are expanded; the failing one starts open. */
  const [openSteps, setOpenSteps] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    setOpenSteps(new Set(failed ? [failed.order] : []));
  }, [failed?.order]);
  const toggleStep = (order: number): void =>
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (!next.delete(order)) next.add(order);
      return next;
    });
  const stepRows = useRef(new Map<number, HTMLLIElement>());
  const revealStep = (order: number): void => {
    setOpenSteps((prev) => new Set(prev).add(order));
    requestAnimationFrame(() => stepRows.current.get(order)?.scrollIntoView({ block: "nearest" }));
  };

  const [summaryOpen, setSummaryOpen] = useState(false);
  /** Which screenshot the lightbox is showing; null = closed. */
  const [openShot, setOpenShot] = useState<number | null>(null);

  if (raw) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        {[test.spec, test.seed].map(
          (file) =>
            file && (
              <div key={file.file} className="min-w-0">
                <div className="font-mono text-[11px] text-muted-foreground">{file.file}</div>
                <ArtifactRaw content={file.content} label={file.file} />
              </div>
            ),
        )}
        {!test.spec && <p className="text-[12px] text-muted-foreground">A blocked flow has no test file.</p>}
      </div>
    );
  }

  const verdict = VERDICT[test.status];
  const passedCount = steps.filter((step) => step.outcome === "passed").length;
  const unreached = steps.filter((step) => step.outcome === "not-reached").length;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-label="Test verdict" className="min-w-0 shrink-0">
        <div className={LABEL}>Verdict</div>
        <div className={`min-w-0 max-w-full rounded border bg-card px-3 py-2.5 ${verdict.border}`}>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${verdict.dot}`} />
              <span className="text-[12px] leading-none text-foreground">{verdict.word}</span>
            </span>
            {run && <span className="text-[11px] text-muted-foreground">{formatGuardDuration(run.durationMs)}</span>}
            {steps.length > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {passedCount} passed
                {failed ? " · 1 failed" : ""}
                {unreached > 0 ? ` · ${unreached} not reached` : ""}
              </span>
            )}
            {!run && test.status !== "blocked" && (
              <span className="text-[11px] text-muted-foreground">No run recorded</span>
            )}
          </div>
          {failed && (
            <p className="mt-1.5 min-w-0 text-[12px] leading-snug">
              <button
                type="button"
                onClick={() => revealStep(failed.order)}
                className="cursor-pointer rounded text-foreground underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Failed at step {failed.order} of {steps.length}
              </button>
            </p>
          )}
          {test.disagreement && (
            <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-[12px] leading-snug md:grid-cols-2">
              <div className="min-w-0">
                <dt className="font-medium text-foreground">Documented</dt>
                <dd className="mt-0.5 break-words text-muted-foreground">{test.disagreement.documented}</dd>
              </div>
              <div className="min-w-0">
                <dt className="font-medium text-foreground">Observed</dt>
                <dd className="mt-0.5 break-words text-foreground">{test.disagreement.observed}</dd>
              </div>
            </dl>
          )}
          {test.status === "blocked" && test.blockedBy && (
            <p className="mt-1.5 min-w-0 break-words text-[12px] leading-snug text-foreground">{test.blockedBy}</p>
          )}
        </div>
      </section>

      {where && (
        <GuardRunFilmstrip
          repoId={repoId}
          where={where}
          screenshots={screenshots}
          videos={videos}
          {...(failed ? { failedStep: failed.order } : {})}
          onOpenShot={setOpenShot}
          onGoToStep={revealStep}
        />
      )}

      {(steps.length > 0 || test.seed) && (
        <section aria-label="Steps" className="min-w-0">
          <div className={LABEL}>Steps</div>
          <div className="min-w-0 rounded border border-border">
            <ol className="min-w-0">
              {test.seed && (
                <li aria-label="Starting data" className="border-b border-border/50 last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={openSteps.has(SEED_STEP)}
                    onClick={() => toggleStep(SEED_STEP)}
                    className={STEP_ROW}
                  >
                    <Chevron open={openSteps.has(SEED_STEP)} />
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                    <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">0</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                      Starting data, created by this test's seed on every run
                    </span>
                  </button>
                  {openSteps.has(SEED_STEP) && (
                    <div className="min-w-0 px-2.5 pb-2.5">
                      <pre className={PRE} aria-label="seed source">
                        {test.seed.content}
                      </pre>
                    </div>
                  )}
                </li>
              )}
              {steps.map((step) => {
                const open = openSteps.has(step.order);
                const shot = screenshots.find((visual) => visual.step === step.order);
                return (
                  <li
                    key={step.order}
                    ref={(node) => {
                      if (node) stepRows.current.set(step.order, node);
                      else stepRows.current.delete(step.order);
                    }}
                    aria-label={`Step ${step.order}: ${step.title}, ${STEP_WORD[step.outcome]}`}
                    className={`border-b border-border/50 last:border-b-0 ${STEP_BAND[step.outcome]}`}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      title={step.title}
                      onClick={() => toggleStep(step.order)}
                      className={STEP_ROW}
                    >
                      <Chevron open={open} />
                      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STEP_DOT[step.outcome]}`} />
                      <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        {step.order}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{step.title}</span>
                      {step.durationMs != null && (
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {formatGuardDuration(step.durationMs)}
                        </span>
                      )}
                    </button>
                    {open && (
                      <div className="flex min-w-0 flex-col gap-2 px-2.5 pb-2.5 text-[12px]">
                        {step.error ? (
                          <GuardLongText text={step.error} label="what the assertion said" />
                        ) : (
                          <p className="text-muted-foreground">
                            {step.outcome === "not-reached"
                              ? "An earlier step failed, so this one never started."
                              : "Every assertion in this step held."}
                          </p>
                        )}
                        {shot && where && (
                          <GuardStepScreenshot
                            repoId={repoId}
                            where={where}
                            visual={shot}
                            onOpen={() => setOpenShot(screenshots.findIndex((v) => v.file === shot.file))}
                          />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      )}

      <section aria-label="Summary" className="min-w-0 rounded border border-border">
        <button
          type="button"
          aria-expanded={summaryOpen}
          onClick={() => setSummaryOpen((prev) => !prev)}
          className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground outline-none hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <Chevron open={summaryOpen} />
          <ScrollText aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Summary
        </button>
        {summaryOpen && (
          <p className="min-w-0 whitespace-pre-wrap break-words border-t border-border p-2.5 text-[12px] leading-relaxed text-foreground">
            {test.summary}
          </p>
        )}
      </section>

      {rulings}

      {(test.spec || test.seed) && (
        <dl className="flex min-w-0 flex-wrap gap-x-5 gap-y-1 text-[11px]">
          {test.spec && (
            <div className="flex min-w-0 items-baseline gap-1.5">
              <dt className="shrink-0 text-muted-foreground">Test</dt>
              <dd className="min-w-0 truncate font-mono">{test.spec.file}</dd>
            </div>
          )}
          {test.seed && (
            <div className="flex min-w-0 items-baseline gap-1.5">
              <dt className="shrink-0 text-muted-foreground">Seed</dt>
              <dd className="min-w-0 truncate font-mono">{test.seed.file}</dd>
            </div>
          )}
        </dl>
      )}

      {openShot != null && where && screenshots[openShot] && (
        <GuardScreenshotLightbox
          repoId={repoId}
          where={where}
          screenshots={screenshots}
          index={openShot}
          onIndex={setOpenShot}
          onClose={() => setOpenShot(null)}
          onGoToStep={(step) => {
            setOpenShot(null);
            revealStep(step);
          }}
        />
      )}
    </div>
  );
}
