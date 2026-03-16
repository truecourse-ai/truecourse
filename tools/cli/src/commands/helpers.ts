import * as p from "@clack/prompts";
import { io, type Socket } from "socket.io-client";

const DEFAULT_PORT = 3001;

export function getServerUrl(): string {
  const port = process.env.PORT || DEFAULT_PORT;
  return `http://localhost:${port}`;
}

export async function ensureServer(): Promise<void> {
  const url = getServerUrl();
  try {
    const res = await fetch(`${url}/api/health`);
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }
  } catch {
    p.log.error(
      "Could not connect to TrueCourse server. Is it running?\n" +
        "  Start it with: npx truecourse start"
    );
    process.exit(1);
  }
}

export async function ensureRepo(): Promise<{ id: string; name: string }> {
  const url = getServerUrl();
  const repoPath = process.cwd();

  const res = await fetch(`${url}/api/repos`, {
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

  return (await res.json()) as { id: string; name: string };
}

export function connectSocket(repoId: string): Socket {
  const url = getServerUrl();
  const socket = io(url, {
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    transports: ["websocket", "polling"],
  });

  socket.connect();

  socket.on("connect", () => {
    socket.emit("joinRepo", repoId);
  });

  if (socket.connected) {
    socket.emit("joinRepo", repoId);
  }

  return socket;
}

type Severity = string;

export function severityIcon(severity: Severity): string {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "high") return "\u2716";
  if (s === "medium") return "\u26A0";
  return "\u2139";
}

export function severityColor(severity: Severity): (text: string) => string {
  const s = severity.toLowerCase();
  if (s === "critical") return (t) => `\x1b[91m${t}\x1b[0m`; // bright red
  if (s === "high") return (t) => `\x1b[31m${t}\x1b[0m`; // red
  if (s === "medium") return (t) => `\x1b[33m${t}\x1b[0m`; // yellow
  return (t) => `\x1b[36m${t}\x1b[0m`; // cyan for low/info
}

export type Violation = {
  id: string;
  type: string;
  title: string;
  content: string;
  severity: string;
  targetServiceName?: string | null;
  targetModuleName?: string | null;
  targetMethodName?: string | null;
  targetDatabaseName?: string | null;
  targetTable?: string | null;
  fixPrompt?: string | null;
};

function buildTargetPath(v: Violation): string {
  const parts: string[] = [];
  if (v.targetServiceName) parts.push(v.targetServiceName);
  if (v.targetDatabaseName) parts.push(v.targetDatabaseName);
  if (v.targetModuleName) parts.push(v.targetModuleName);
  if (v.targetMethodName) parts.push(v.targetMethodName);
  if (v.targetTable) parts.push(`table: ${v.targetTable}`);
  return parts.join(" :: ");
}

function wrapText(text: string, indent: string, maxWidth: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : `${indent}${l}`)).join("\n");
}

export function renderViolations(violations: Violation[]): void {
  if (violations.length === 0) {
    p.log.info("No violations found. Run `truecourse analyze` first.");
    return;
  }

  console.log("");

  const counts: Record<string, number> = {};

  for (const v of violations) {
    const sev = v.severity.toLowerCase();
    counts[sev] = (counts[sev] || 0) + 1;

    const icon = severityIcon(v.severity);
    const color = severityColor(v.severity);
    const label = v.severity.toUpperCase();
    const target = buildTargetPath(v);

    console.log(`  ${color(`${icon} ${label}`)}  ${v.title}`);
    if (target) {
      console.log(`              ${target}`);
    }
    if (v.fixPrompt) {
      const indent = "              ";
      console.log("");
      console.log(`              Fix: ${wrapText(v.fixPrompt, indent + "     ", 60)}`);
    }
    console.log("");
  }

  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");

  const parts: string[] = [];
  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    if (counts[sev]) parts.push(`${counts[sev]} ${sev}`);
  }
  console.log(`  ${violations.length} violations (${parts.join(", ")})`);
  console.log("");
}

export type DiffResult = {
  changedFiles: Array<{ path: string; status: "new" | "modified" | "deleted" }>;
  newInsights: Array<Violation & { fixPrompt?: string | null }>;
  resolvedInsights: Violation[];
  summary: { newCount: number; resolvedCount: number };
  isStale?: boolean;
};

export function renderDiffResults(result: DiffResult): void {
  console.log("");

  // Changed files summary
  const modified = result.changedFiles.filter((f) => f.status === "modified").length;
  const newFiles = result.changedFiles.filter((f) => f.status === "new").length;
  const deleted = result.changedFiles.filter((f) => f.status === "deleted").length;
  const fileParts: string[] = [];
  if (modified) fileParts.push(`${modified} modified`);
  if (newFiles) fileParts.push(`${newFiles} new`);
  if (deleted) fileParts.push(`${deleted} deleted`);
  console.log(`  Changed files: ${result.changedFiles.length} (${fileParts.join(", ")})`);
  console.log("");

  if (result.isStale) {
    console.log(`  \x1b[33m\u26A0 Results may be stale \u2014 baseline analysis has changed.\x1b[0m`);
    console.log("");
  }

  // New issues
  if (result.newInsights.length > 0) {
    console.log(`  NEW ISSUES (${result.newInsights.length})`);
    console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    for (const v of result.newInsights) {
      const icon = severityIcon(v.severity);
      const color = severityColor(v.severity);
      const label = v.severity.toUpperCase();
      const target = buildTargetPath(v);

      console.log(`  ${color(`${icon} ${label}`)}  ${v.title}`);
      if (target) {
        console.log(`              ${target}`);
      }
      if (v.fixPrompt) {
        const indent = "              ";
        console.log("");
        console.log(`              Fix: ${wrapText(v.fixPrompt, indent + "     ", 60)}`);
      }
      console.log("");
    }
  } else {
    console.log("  NEW ISSUES (0)");
    console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    console.log("  None");
    console.log("");
  }

  // Resolved
  if (result.resolvedInsights.length > 0) {
    console.log(`  RESOLVED (${result.resolvedInsights.length})`);
    console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    for (const v of result.resolvedInsights) {
      const target = buildTargetPath(v);
      const color = severityColor(v.severity);
      const label = v.severity.toUpperCase();

      console.log(`  ${color(`\u2714 ${label}`)}  ${v.title}`);
      if (target) {
        console.log(`              ${target}`);
      }
      console.log("");
    }
  } else {
    console.log("  RESOLVED (0)");
    console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    console.log("  None");
    console.log("");
  }

  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(`  Summary: ${result.summary.newCount} new issues, ${result.summary.resolvedCount} resolved`);
  console.log("");
}
