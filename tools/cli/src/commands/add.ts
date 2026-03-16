import * as p from "@clack/prompts";
import { getServerUrl } from "./helpers.js";

export async function runAdd(): Promise<void> {
  const repoPath = process.cwd();
  const serverUrl = getServerUrl();

  p.intro("Adding repository to TrueCourse");
  p.log.step(repoPath);

  try {
    const res = await fetch(`${serverUrl}/api/repos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: repoPath }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let message = `Server returned ${res.status}`;
      try {
        const json = JSON.parse(body);
        if (json.error) message = json.error;
      } catch {
        if (body) message = body;
      }
      p.log.error(message);
      process.exit(1);
    }

    const repo = (await res.json()) as { id: string; name: string };
    const repoUrl = `${serverUrl}/repos/${repo.id}`;

    p.log.success(`Repository "${repo.name}" added`);
    p.outro(`Open ${repoUrl}`);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);

    if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      p.log.error(
        "Could not connect to TrueCourse server. Is it running?\n" +
          "  Start it with: npx truecourse start"
      );
    } else {
      p.log.error(message);
    }
    process.exit(1);
  }
}
