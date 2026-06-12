// JSON.parse / JSON.stringify called with a value that is freshly computed
// on each iteration of the enclosing loop is not the "same-data-each-iter"
// anti-pattern this rule targets. The argument changes every iteration —
// caching the call outside the loop is impossible.

interface RawEntry {
  contents: unknown;
}

interface ToolCallRaw {
  rawInput: unknown;
  toolName: string;
}

interface SerializedEntry {
  serialized: string;
  size: number;
}

interface ToolUse {
  toolName: string;
  inputJson: string;
}

// Sample shape A: identifier declared inside the loop body. Each iteration
// produces a fresh `entry`, so stringifying it is not constant-data work.
export function serializeAll(entries: readonly RawEntry[]): SerializedEntry[] {
  const out: SerializedEntry[] = [];
  for (const entry of entries) {
    const next = entry;
    const serialized = JSON.stringify(next.contents);
    out.push({
      serialized,
      size: Buffer.byteLength(serialized, "utf8"),
    });
  }
  return out;
}

// Sample shape B: ternary branches reference a value derived from the loop
// iteration. The serialized argument is dynamic, not a constant.
export function collectToolUses(raws: readonly ToolCallRaw[]): ToolUse[] {
  const out: ToolUse[] = [];
  for (const item of raws) {
    const tc = item;
    out.push({
      toolName: tc.toolName,
      inputJson: JSON.stringify(
        tc.rawInput && typeof tc.rawInput === "object" ? tc.rawInput : {},
        null,
        2,
      ),
    });
  }
  return out;
}
