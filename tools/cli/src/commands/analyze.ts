import * as p from "@clack/prompts";
import type { Violation, DiffResult } from "./helpers.js";
import {
  ensureServer,
  ensureRepo,
  getServerUrl,
  connectSocket,
  renderViolationsSummary,
  renderDiffResultsSummary,
  openInBrowser,
} from "./helpers.js";

const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export async function runAnalyze({ noAutostart = false, codeReview = false, deterministicOnly = false } = {}): Promise<void> {
  p.intro("Analyzing repository");

  if (noAutostart) {
    // Check if server is running without auto-starting
    const url = getServerUrl();
    try {
      const res = await fetch(`${url}/api/health`);
      if (!res.ok) throw new Error();
    } catch {
      p.log.error("TrueCourse server is not running. Start it with: npx truecourse start");
      process.exit(1);
    }
  }

  const firstRun = noAutostart ? false : await ensureServer();
  const repo = await ensureRepo();
  p.log.step(`Repository: ${repo.name}`);

  const serverUrl = getServerUrl();
  const socket = connectSocket(repo.id);

  const spinner = p.spinner();
  spinner.start("Starting analysis...");

  // Handle Ctrl+C — cancel the analysis on the server
  let canceled = false;
  const onSigint = () => {
    if (canceled) return; // second Ctrl+C — let it force exit
    canceled = true;
    spinner.stop("Cancelling analysis...");
    fetch(`${serverUrl}/api/repos/${repo.id}/analyze/cancel`, { method: "POST" })
      .catch(() => {}) // ignore errors
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

      socket.on("analysis:progress", (data: { step: string; percent: number; detail?: string }) => {
        const detail = data.detail ? ` — ${data.detail}` : "";
        spinner.message(`${data.step} (${data.percent}%)${detail}`);
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
        spinner.message("Generating violations...");
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

      // Trigger analysis
      fetch(`${serverUrl}/api/repos/${repo.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codeReview, deterministicOnly }),
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

    spinner.stop("Analysis complete");

    // Fetch violations
    const res = await fetch(`${serverUrl}/api/repos/${repo.id}/violations`);
    if (!res.ok) {
      p.log.error(`Failed to fetch violations: ${res.status}`);
      process.exit(1);
    }

    const violations = (await res.json()) as Violation[];
    renderViolationsSummary(violations);

    if (!deterministicOnly) {
      p.log.info("Code review running in background — results will appear in the dashboard");
    }

    const repoUrl = `${serverUrl}/repos/${repo.id}`;
    if (firstRun) {
      openInBrowser(repoUrl);
      p.outro("Analysis complete — opened in browser");
    } else {
      p.outro(`Analysis complete — open ${repoUrl}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "CANCELED") {
      spinner.stop("Analysis cancelled");
      p.outro("Analysis cancelled");
    } else {
      spinner.stop("Analysis failed");
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
