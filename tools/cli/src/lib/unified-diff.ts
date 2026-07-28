/**
 * A minimal line diff for the terminal — enough to show what replacing one small
 * committed JSON file with another actually changed. Plain unified-ish output
 * (` ` context, `-` removed, `+` added) over an LCS table; the inputs here are
 * recipe.json-sized (tens of lines), so the O(n·m) table is free and a diff
 * dependency would be the only thing the CLI pulls in for it.
 */

/** The diff lines: `-`/`+` for changes, two lines of ` ` context around each hunk. */
export function unifiedDiff(before: string, after: string, context = 2): string[] {
  // One trailing newline is the file's terminator, not an empty last line — left in
  // it would render as a phantom context row on every diff.
  const a = before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  const ops = lcsOps(a, b);
  if (!ops.some((op) => op.kind !== " ")) return [];

  // Keep only the neighbourhood of each change; everything else collapses to `…`.
  const keep = new Set<number>();
  ops.forEach((op, i) => {
    if (op.kind === " ") return;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) keep.add(j);
  });

  const lines: string[] = [];
  let elided = false;
  ops.forEach((op, i) => {
    if (!keep.has(i)) {
      if (!elided) lines.push("…");
      elided = true;
      return;
    }
    elided = false;
    lines.push(`${op.kind}${op.line}`);
  });
  return lines;
}

interface DiffOp {
  kind: " " | "-" | "+";
  line: string;
}

/** Longest-common-subsequence alignment of two line arrays. */
function lcsOps(a: string[], b: string[]): DiffOp[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", line: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: "-", line: a[i] });
      i++;
    } else {
      ops.push({ kind: "+", line: b[j] });
      j++;
    }
  }
  while (i < a.length) ops.push({ kind: "-", line: a[i++] });
  while (j < b.length) ops.push({ kind: "+", line: b[j++] });
  return ops;
}
