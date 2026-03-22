import * as p from "@clack/prompts";
import { getServerUrl, openInBrowser } from "./helpers.js";
import { cpSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

    // Prompt to install Claude Code skills
    const installSkills = await p.confirm({
      message: "Would you like to install Claude Code skills?",
    });

    if (p.isCancel(installSkills)) {
      openInBrowser(repoUrl);
      p.outro("Opened in browser");
      return;
    }

    if (installSkills) {
      const cliDir = dirname(fileURLToPath(import.meta.url));
      // In dist: dist/commands/add.js → skills/truecourse/
      // In src:  src/commands/add.ts → ../../skills/truecourse/
      const skillsSrc = resolve(cliDir, "..", "..", "skills", "truecourse");

      if (!existsSync(skillsSrc)) {
        p.log.warn("Skills directory not found in package — skipping.");
      } else {
        const skillsDest = resolve(repoPath, ".claude", "skills", "truecourse");
        cpSync(skillsSrc, skillsDest, { recursive: true });

        p.log.success("Installed Claude Code skills:");
        p.log.message("  - truecourse-analyze  (run analysis)");
        p.log.message("  - truecourse-list     (list violations)");
        p.log.message("  - truecourse-fix      (apply fixes)");
      }
    }

    openInBrowser(repoUrl);
    p.outro("Opened in browser");
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
