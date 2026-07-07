/**
 * Output-only guardrail — one shared line, embedded near the top of every
 * output-only LLM system prompt (guard extract/recipe, spec-scan
 * relevance/area-tag/vocab/overlap/chain). It closes the action space: some
 * models still EMIT tool-call-shaped text when told to answer with JSON, trying
 * to inspect the repo before asserting. The transport already runs `claude` with
 * no tools (`--tools ''`) and a fully-replaced system prompt (`--system-prompt`,
 * not `--append-system-prompt`), so the model has no tools AND no harness priming;
 * this line stops the model from producing tool-call markup as its *answer*.
 *
 * Shape-agnostic on purpose: different stages ask for a JSON object (extract,
 * relevance, …) or a JSON array (some batched stages), so the text says "object
 * or array, exactly as specified" and never assumes one shape.
 */
export const OUTPUT_ONLY_GUARDRAIL = `You have NO tools and NO repository or filesystem access: you cannot read files, run commands, or inspect code. Tool-call JSON or \`<tool_use>\` markup is INVALID output. Answer only from the context given below; your ENTIRE response can ONLY be the single JSON value the instructions ask for (an object or array, exactly as specified) — nothing before it, nothing after it.`
