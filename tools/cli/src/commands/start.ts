import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runStart(): Promise<void> {
  p.intro("Starting TrueCourse");

  // In packaged mode, the server bundle is at dist/server.mjs (sibling to cli.mjs)
  const serverPath = path.join(__dirname, "server.mjs");

  p.log.step(
    "Starting server (embedded PostgreSQL starts automatically)..."
  );

  const serverProcess = spawn(
    process.execPath,
    [serverPath],
    {
      stdio: "inherit",
      env: { ...process.env },
    }
  );

  serverProcess.on("error", (error) => {
    p.log.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  });

  serverProcess.on("close", (code) => {
    if (code !== null && code !== 0) {
      process.exit(code);
    }
  });

  const cleanup = () => {
    serverProcess.kill("SIGTERM");
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
