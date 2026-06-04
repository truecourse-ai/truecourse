// Stand-in for a CLI prompt library (e.g. `@clack/prompts`). The
// positive fixture imports its `confirm` / `prompt` helpers; the rule
// must treat the call sites as references to these locals, not the
// browser dialogs.

type PromptOpts = { message: string };

export function confirm(_opts: PromptOpts): Promise<boolean> {
  return Promise.resolve(true);
}

export default function prompt(_opts: PromptOpts): Promise<string> {
  return Promise.resolve("");
}
