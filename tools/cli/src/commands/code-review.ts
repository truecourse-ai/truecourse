import * as p from "@clack/prompts";
import {
  ensureServer,
  ensureRepo,
  getServerUrl,
  connectSocket,
} from "./helpers.js";

export async function runCodeReviewCmd({ noAutostart = false, diff = false } = {}): Promise<void> {
  p.intro(diff ? "Running code review (diff mode)" : "Running code review");

  if (noAutostart) {
    const url = getServerUrl();
    const res = await fetch(`${url}/api/health`).catch(() => null);
    if (!res?.ok) {
      p.log.error("Server is not running. Start it with: truecourse start");
      process.exit(1);
    }
  } else {
    await ensureServer();
  }

  const serverUrl = getServerUrl();
  const repo = await ensureRepo();

  // Get analysis to run code review on
  let analysisId: string;

  if (diff) {
    // Get latest diff analysis
    const diffRes = await fetch(`${serverUrl}/api/repos/${repo.id}/diff-check`);
    if (!diffRes.ok) {
      p.log.error("Failed to fetch diff check");
      process.exit(1);
    }
    const diffResult = await diffRes.json() as { diffAnalysisId: string } | null;
    if (!diffResult?.diffAnalysisId) {
      p.log.error("No diff analysis found. Run 'truecourse analyze --diff' first.");
      process.exit(1);
    }
    analysisId = diffResult.diffAnalysisId;
    p.log.info(`Running code review on diff analysis (${analysisId.slice(0, 8)})`);
  } else {
    // Get latest normal analysis
    const analysesRes = await fetch(`${serverUrl}/api/repos/${repo.id}/analyses`);
    if (!analysesRes.ok) {
      p.log.error("Failed to fetch analyses");
      process.exit(1);
    }
    const analyses = await analysesRes.json() as { id: string }[];
    if (analyses.length === 0) {
      p.log.error("No analysis found. Run 'truecourse analyze' first.");
      process.exit(1);
    }
    analysisId = analyses[0].id;
    p.log.info(`Running code review on latest analysis (${analysisId.slice(0, 8)})`);
  }

  const spinner = p.spinner();
  spinner.start("Running code review...");

  // Connect socket for progress
  const socket = connectSocket(repo.id);

  return new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      spinner.stop("Code review complete");
      socket.disconnect();
      p.outro("Done");
      resolve();
    };

    socket.on("code-review:ready", () => done());

    // Timeout after 15 minutes
    const timeout = setTimeout(() => {
      spinner.stop("Code review timed out");
      socket.disconnect();
      p.outro("Timed out waiting for code review");
      resolve();
    }, 15 * 60 * 1000);

    socket.on("code-review:ready", () => clearTimeout(timeout));

    // Trigger code review
    fetch(`${serverUrl}/api/repos/${repo.id}/analyses/${analysisId}/code-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).then((res) => {
      if (!res.ok) {
        spinner.stop("Failed to start code review");
        clearTimeout(timeout);
        socket.disconnect();
        p.outro("Failed");
        resolve();
      }
    });
  });
}
