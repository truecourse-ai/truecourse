import * as p from "@clack/prompts";
import type { Violation, DiffResult } from "./helpers.js";
import {
  ensureServer,
  ensureRepo,
  getServerUrl,
  connectSocket,
  renderViolations,
  renderDiffResults,
} from "./helpers.js";

const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export async function runAnalyze(): Promise<void> {
  p.intro("Analyzing repository");

  await ensureServer();
  const repo = await ensureRepo();
  p.log.step(`Repository: ${repo.name}`);

  const serverUrl = getServerUrl();
  const socket = connectSocket(repo.id);

  const spinner = p.spinner();
  spinner.start("Starting analysis...");

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

      // Trigger analysis
      fetch(`${serverUrl}/api/repos/${repo.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
    renderViolations(violations);

    const repoUrl = `${serverUrl}/repos/${repo.id}`;
    const link = `\x1b[4m\x1b[34m${repoUrl}\x1b[0m`;
    p.outro(`Open ${link} to see violations and architecture diagrams in the UI`);
  } catch (err) {
    spinner.stop("Analysis failed");
    const message = err instanceof Error ? err.message : String(err);
    p.log.error(message);
    process.exit(1);
  } finally {
    socket.disconnect();
  }
}

export async function runAnalyzeDiff(): Promise<void> {
  p.intro("Running diff check");

  await ensureServer();
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
    renderDiffResults(result);
  } catch (err) {
    spinner.stop("Diff check failed");
    const message = err instanceof Error ? err.message : String(err);
    p.log.error(message);
    process.exit(1);
  } finally {
    socket.disconnect();
  }
}
