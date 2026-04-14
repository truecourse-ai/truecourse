import * as p from "@clack/prompts";
import type { Violation, DiffResult } from "./helpers.js";
import {
  ensureServer,
  ensureRepo,
  getServerUrl,
  connectSocket,
  readConfig,
  renderViolationsSummary,
  renderDiffResultsSummary,
} from "./helpers.js";
import { showFirstRunNotice } from "../telemetry.js";

const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

interface AnalysisStep {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
}

// Spinner frames for active steps
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerFrame = 0;
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let latestSteps: AnalysisStep[] | null = null;
let renderedLineCount = 0;

function renderSteps(steps: AnalysisStep[]): void {
  // Move cursor up to overwrite previous render
  if (renderedLineCount > 0) {
    process.stderr.write(`\x1b[${renderedLineCount}A`);
  }
  for (const step of steps) {
    const detail = step.detail ? ` — ${step.detail}` : "";

    let icon: string;
    let color: string;
    const reset = "\x1b[0m";

    switch (step.status) {
      case "pending":
        icon = "○";
        color = "\x1b[2m";
        break;
      case "active":
        icon = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
        color = "\x1b[36m"; // cyan
        break;
      case "done":
        icon = "●";
        color = "\x1b[32m"; // green
        break;
      case "error":
        icon = "✕";
        color = "\x1b[31m"; // red
        break;
      default:
        icon = "○";
        color = "";
    }

    process.stderr.write(`\x1b[2K${color}  ${icon} ${step.label}${detail}${reset}\n`);
  }
  renderedLineCount = steps.length;

  // Start spinner animation if there are active steps
  const hasActive = steps.some((s) => s.status === "active");
  if (hasActive && !spinnerInterval) {
    latestSteps = steps;
    spinnerInterval = setInterval(() => {
      spinnerFrame++;
      if (latestSteps) renderSteps(latestSteps);
    }, 80);
  } else if (hasActive) {
    latestSteps = steps;
  } else if (!hasActive && spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    latestSteps = null;
  }
}

function stopSpinner(): void {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
}

export async function runAnalyze({ noAutostart = false } = {}): Promise<void> {
  p.intro("Analyzing repository");
  showFirstRunNotice();

  if (noAutostart) {
    const url = getServerUrl();
    try {
      const res = await fetch(`${url}/api/health`);
      if (!res.ok) throw new Error();
    } catch {
      p.log.error("TrueCourse server is not running. Start it with: npx truecourse start");
      process.exit(1);
    }
  }

  if (!noAutostart) await ensureServer();
  const repo = await ensureRepo();
  p.log.step(`Repository: ${repo.name}`);

  const config = readConfig();

  const serverUrl = getServerUrl();
  const socket = connectSocket(repo.id);

  const spinner = p.spinner();
  spinner.start("Starting analysis...");

  // Handle Ctrl+C — cancel the analysis on the server
  let canceled = false;
  const onSigint = () => {
    if (canceled) return;
    canceled = true;
    stopSpinner();
    spinner.stop("Cancelling analysis...");
    fetch(`${serverUrl}/api/repos/${repo.id}/analyze/cancel`, { method: "POST" })
      .catch(() => {})
      .finally(() => {
        socket.disconnect();
        process.exit(130);
      });
  };
  process.on("SIGINT", onSigint);

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Analysis timed out after 15 minutes"));
      }, TIMEOUT_MS);

      let stepsRendered = false;
      let llmMode = false; // true when LLM is enabled (steps include 'scan')
      let llmPromptAnswered = false;

      let lastSteps: AnalysisStep[] | null = null;
      const prePromptKeys = new Set(['parse', 'scan']);

      socket.on("analysis:progress", (data: { step: string; percent: number; detail?: string; steps?: AnalysisStep[] }) => {
        if (data.steps && data.steps.length > 0) {
          lastSteps = data.steps;

          // Detect LLM mode on first event
          if (!llmMode && !stepsRendered && data.steps.some((s) => s.key === "scan")) {
            llmMode = true;
          }

          if (llmMode && !llmPromptAnswered) {
            // Before LLM prompt: show parse/scan as spinner messages
            const parseStep = data.steps.find((s) => s.key === 'parse');
            const scanStep = data.steps.find((s) => s.key === 'scan');
            if (scanStep?.status === 'done') {
              spinner.message(`Scanning files — ${scanStep.detail ?? 'done'}`);
            } else if (scanStep?.status === 'active') {
              spinner.message(`Scanning files${scanStep.detail ? ` — ${scanStep.detail}` : '...'}`);
            } else if (parseStep?.status === 'done') {
              spinner.message(`Parsing repository — ${parseStep.detail ?? 'done'}`);
            } else if (parseStep?.status === 'active') {
              spinner.message(`Parsing repository${parseStep.detail ? ` — ${parseStep.detail}` : '...'}`);
            }
            return;
          }

          // No-LLM mode or after LLM prompt: render step checklist
          if (!stepsRendered) {
            spinner.stop("Analyzing...");
            stepsRendered = true;
          }

          // In LLM mode, filter out parse/scan since they were already shown as spinners
          const stepsToRender = llmMode
            ? data.steps.filter((s) => !prePromptKeys.has(s.key))
            : data.steps;
          renderSteps(stepsToRender);
        }
      });

      let analysisComplete = false;
      let violationsReady = false;

      function checkDone() {
        if (analysisComplete && violationsReady) {
          clearTimeout(timeout);
          resolve();
        }
      }

      socket.on("analysis:complete", () => {
        analysisComplete = true;
        checkDone();
      });

      socket.on("violations:ready", () => {
        violationsReady = true;
        checkDone();
      });

      socket.on("analysis:canceled", () => {
        clearTimeout(timeout);
        reject(new Error("CANCELED"));
      });

      // Handle LLM estimate confirmation
      socket.on("analysis:llm-estimate", async (data: {
        analysisId: string;
        estimate: { totalEstimatedTokens: number; uniqueFileCount?: number; uniqueRuleCount?: number; tiers: Array<{ tier: string; ruleCount: number; fileCount: number; functionCount?: number; estimatedTokens: number }> };
      }) => {
        // Stop spinner, show parse/scan as completed log lines
        stopSpinner();
        if (lastSteps) {
          const parseStep = lastSteps.find((s) => s.key === 'parse');
          const scanStep = lastSteps.find((s) => s.key === 'scan');
          if (parseStep) spinner.stop(`Parsing repository${parseStep.detail ? ` — ${parseStep.detail}` : ''}`);
          if (scanStep) p.log.step(`Scanning files${scanStep.detail ? ` — ${scanStep.detail}` : ''}`);
        } else {
          spinner.stop("Analyzing...");
        }

        const totalRules = data.estimate.uniqueRuleCount ?? data.estimate.tiers.reduce((s, t) => s + t.ruleCount, 0);
        const totalFiles = data.estimate.uniqueFileCount ?? data.estimate.tiers.reduce((s, t) => s + t.fileCount, 0);
        const tokens = data.estimate.totalEstimatedTokens;
        const tokenStr = tokens >= 1_000_000
          ? `~${(tokens / 1_000_000).toFixed(1)}M tokens`
          : `~${Math.round(tokens / 1000)}k tokens`;
        p.log.step(`LLM will analyze ${totalFiles} files with ${totalRules} rules (${tokenStr})`);

        const proceed = await p.confirm({
          message: "Run LLM-powered rules?",
          initialValue: true,
        });

        const shouldProceed = !p.isCancel(proceed) && proceed;
        if (!shouldProceed) {
          p.log.info("Skipping LLM rules.");
        }

        // Now show domain checklist — render cached state (without parse/scan)
        llmPromptAnswered = true;
        stepsRendered = true;
        renderedLineCount = 0;
        if (lastSteps) {
          const domainSteps = lastSteps.filter((s) => !prePromptKeys.has(s.key));
          renderSteps(domainSteps);
        }

        socket.emit("analysis:llm-proceed", {
          analysisId: data.analysisId,
          proceed: shouldProceed,
        });
      });

      // Trigger analysis
      fetch(`${serverUrl}/api/repos/${repo.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledCategories: config.enabledCategories ?? [], enableLlmRules: config.enableLlmRules ?? true }),
      }).then((res) => {
        if (!res.ok) {
          clearTimeout(timeout);
          res.text().then((body) => {
            let msg = `Server returned ${res.status}`;
            try {
              const json = JSON.parse(body);
              if (json.error) msg = json.error;
            } catch {
              if (body) msg = body;
            }
            reject(new Error(msg));
          });
        }
      }).catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    stopSpinner();
    p.log.success("Analysis complete");

    // Fetch violations summary
    const res = await fetch(`${serverUrl}/api/repos/${repo.id}/violations/summary`);

    if (res.ok) {
      const summary = (await res.json()) as { total: number; bySeverity: Record<string, number> };
      renderViolationsSummary([], summary);
    } else {
      // Fallback: fetch full violations list
      const fallbackRes = await fetch(`${serverUrl}/api/repos/${repo.id}/violations`);
      if (fallbackRes.ok) {
        const violations = (await fallbackRes.json()) as Violation[];
        renderViolationsSummary(violations);
      }
    }

    p.outro("Analysis complete — view results with: truecourse dashboard");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "CANCELED") {
      p.outro("Analysis cancelled");
    } else {
      p.log.error(message);
      process.exit(1);
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    socket.disconnect();
  }
}

export async function runAnalyzeDiff({ noAutostart = false } = {}): Promise<void> {
  p.intro("Running diff check");
  showFirstRunNotice();

  if (noAutostart) {
    const url = getServerUrl();
    try {
      const res = await fetch(`${url}/api/health`);
      if (!res.ok) throw new Error();
    } catch {
      p.log.error("TrueCourse server is not running. Start it with: npx truecourse start");
      process.exit(1);
    }
  } else {
    await ensureServer();
  }
  const repo = await ensureRepo();
  p.log.step(`Repository: ${repo.name}`);

  const serverUrl = getServerUrl();
  const socket = connectSocket(repo.id);

  const spinner = p.spinner();
  spinner.start("Checking changes...");

  socket.on("analysis:progress", (data: { step: string; percent: number; detail?: string }) => {
    const detail = data.detail ? ` — ${data.detail}` : "";
    spinner.message(`${data.step} (${data.percent}%)${detail}`);
  });

  try {
    const res = await fetch(`${serverUrl}/api/repos/${repo.id}/diff-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let msg = `Server returned ${res.status}`;
      try {
        const json = JSON.parse(body);
        if (json.error) msg = json.error;
      } catch {
        if (body) msg = body;
      }
      throw new Error(msg);
    }

    spinner.stop("Diff check complete");

    const result = (await res.json()) as DiffResult;
    renderDiffResultsSummary(result);
  } catch (err) {
    spinner.stop("Diff check failed");
    const message = err instanceof Error ? err.message : String(err);
    p.log.error(message);
    process.exit(1);
  } finally {
    socket.disconnect();
  }
}
