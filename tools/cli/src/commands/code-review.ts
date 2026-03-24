import * as p from "@clack/prompts";
import {
  ensureServer,
  ensureRepo,
  getServerUrl,
  connectSocket,
} from "./helpers.js";

export async function runCodeReviewCmd({ noAutostart = false } = {}): Promise<void> {
  p.intro("Running code review");

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

  // Get latest analysis
  const analysesRes = await fetch(`${serverUrl}/api/repos/${repo.id}/analyses`);
  if (!analysesRes.ok) {
    p.log.error("Failed to fetch analyses");
    process.exit(1);
  }
  const analyses = await analysesRes.json() as { id: string; branch: string | null; createdAt: string }[];
  if (analyses.length === 0) {
    p.log.error("No analysis found. Run 'truecourse analyze' first.");
    process.exit(1);
  }

  const latestAnalysis = analyses[0];
  p.log.info(`Running code review on latest analysis (${latestAnalysis.id.slice(0, 8)})`);

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
    fetch(`${serverUrl}/api/repos/${repo.id}/analyses/${latestAnalysis.id}/code-review`, {
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
