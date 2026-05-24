/**
 * One-time community prompts shown after successful CLI analyses.
 *
 * - 1st analyze on this machine → invite to Discord.
 * - 2nd analyze on this machine → ask for a GitHub star.
 *
 * State lives at `~/.truecourse/community-prompts.json` and is independent of
 * any prior repo history, so existing users see the prompts the next time
 * they run an analyze. Non-interactive runs (CI, hooks) skip both the print
 * and the counter increment so users never miss the prompt to a CI run.
 */

import fs from "node:fs";
import path from "node:path";
import { getGlobalDir } from "@truecourse/core/config/paths";
import { isInteractive } from "./commands/helpers.js";

const DISCORD_URL = "https://discord.gg/TanxB63arz";
const GITHUB_URL = "https://github.com/truecourse-ai/truecourse";

// OSC 8 hyperlinks would be ideal but width measurement counts the escape
// bytes, breaking the right border. Plain SGR (cyan + underline) is
// stripped correctly, and modern terminals auto-detect bare URLs as
// clickable, so the link feel is preserved without the alignment glitch.
function link(url: string): string {
  return `\x1b[36m\x1b[4m${url}\x1b[0m`;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const visibleWidth = (s: string): number => s.replace(ANSI_RE, "").length;

const SYM = {
  bar: "│",
  hbar: "─",
  step: "◇",
  cornerTR: "╮",
  cornerBR: "╯",
  connectL: "├",
};
const C = {
  gray: "\x1b[90m",
  green: "\x1b[32m",
  reset: "\x1b[0m",
};

function printCenteredNote(title: string, body: string): void {
  const bodyLines = body.split("\n");
  const titleVis = visibleWidth(title);
  const bodyMax = Math.max(...bodyLines.map(visibleWidth));
  const sidePad = 2;
  const inner = Math.max(titleVis + 8, bodyMax + sidePad * 2);

  // Total visible width must equal inner + 4 (matches the body `│ … │` width
  // and the bottom `├──…──╯` width so the right border lines up).
  // Top line layout: ◇ + leftDashes + ' ' + title + ' ' + rightDashes + ╮
  // = 1 + dashes + titleVis + 2 + 1 = dashes + titleVis + 4
  // → dashes = inner - titleVis.
  const dashes = Math.max(2, inner - titleVis);
  const leftDashes = Math.floor(dashes / 2);
  const rightDashes = dashes - leftDashes;
  const top =
    `${C.green}${SYM.step}${C.reset}` +
    `${C.gray}${SYM.hbar.repeat(leftDashes)}${C.reset} ` +
    `${title}` +
    ` ${C.gray}${SYM.hbar.repeat(rightDashes)}${SYM.cornerTR}${C.reset}`;

  const blank = `${C.gray}${SYM.bar}${C.reset} ${" ".repeat(inner)} ${C.gray}${SYM.bar}${C.reset}`;

  const contentRows = bodyLines.map((line) => {
    const vis = visibleWidth(line);
    const leftSpace = Math.floor((inner - vis) / 2);
    const rightSpace = inner - leftSpace - vis;
    return (
      `${C.gray}${SYM.bar}${C.reset} ` +
      " ".repeat(leftSpace) + line + " ".repeat(rightSpace) +
      ` ${C.gray}${SYM.bar}${C.reset}`
    );
  });

  const bottom = `${C.gray}${SYM.connectL}${SYM.hbar.repeat(inner + 2)}${SYM.cornerBR}${C.reset}`;
  const sep = `${C.gray}${SYM.bar}${C.reset}`;

  process.stdout.write([sep, top, blank, ...contentRows, blank, bottom].join("\n") + "\n");
}

interface CommunityPromptsConfig {
  analyzeCount: number;
  discordShown: boolean;
  starShown: boolean;
}

const DEFAULT_CONFIG: CommunityPromptsConfig = {
  analyzeCount: 0,
  discordShown: false,
  starShown: false,
};

function getConfigPath(): string {
  return path.join(getGlobalDir(), "community-prompts.json");
}

function readConfig(): CommunityPromptsConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config: CommunityPromptsConfig): void {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function recordAnalyzeAndMaybePrompt(): void {
  if (!isInteractive()) return;
  try {
    const config = readConfig();
    config.analyzeCount += 1;

    if (config.analyzeCount === 1 && !config.discordShown) {
      printCenteredNote(
        "Join our community",
        `Have a question or want to share feedback?\nJoin the TrueCourse Discord:\n${link(DISCORD_URL)}`,
      );
      config.discordShown = true;
    } else if (config.analyzeCount === 2 && !config.starShown) {
      printCenteredNote(
        "Star us on GitHub",
        `If TrueCourse is helping, a GitHub star goes a long way.\n${link(GITHUB_URL)}`,
      );
      config.starShown = true;
    }

    writeConfig(config);
  } catch {
    // Never break the CLI for community prompts.
  }
}
