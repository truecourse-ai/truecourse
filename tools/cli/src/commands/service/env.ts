import fs from "node:fs";
import path from "node:path";

/**
 * Set or replace a single key in a .env file, preserving any other keys,
 * comments, and ordering. Creates the file (and its parent directory) if
 * neither exists yet. Values containing whitespace or `#` are quoted.
 */
export function writeEnvVar(filePath: string, key: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const quoted = /[\s#"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  const newLine = `${key}=${quoted}`;
  const keyPattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*=`);

  let content = "";
  let replaced = false;

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    const lines = existing.split("\n");
    const updated = lines.map((line) => {
      if (keyPattern.test(line)) {
        replaced = true;
        return newLine;
      }
      return line;
    });
    content = updated.join("\n");
  }

  if (!replaced) {
    if (content && !content.endsWith("\n")) content += "\n";
    content += `${newLine}\n`;
  }

  fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Parse a .env file into key-value pairs.
 * Handles comments, empty lines, and quoted values.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};

  if (!fs.existsSync(filePath)) {
    return vars;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key) {
      vars[key] = value;
    }
  }

  return vars;
}
