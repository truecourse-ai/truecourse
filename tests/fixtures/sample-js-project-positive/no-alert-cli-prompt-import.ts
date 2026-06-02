// CLI prompt libraries (e.g. `@clack/prompts`, `inquirer`, `prompts`)
// ship `confirm` / `prompt` named exports. When a file imports one of
// those, every bare `confirm(...)` or `prompt(...)` call refers to the
// imported helper — not the browser dialog the rule is meant to flag.
// Block the rule whenever a local binding shadows the global.

import { confirm, default as prompt } from "./packages/no-alert-cli-stub";

export async function runDeployFlow(): Promise<string> {
  const ok = await confirm({ message: "Continue?" });
  if (!ok) return "aborted";
  return prompt({ message: "Enter project slug" });
}
