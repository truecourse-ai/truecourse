// A reusable library function that terminates the whole process on bad input.
// This kills the caller's process instead of letting it decide how to handle
// the failure — library code should throw an error instead. There is no
// entry-point guard, so this file is plain library code.
export function requireConfig(raw: string | undefined): string {
  if (!raw) {
    // VIOLATION: reliability/deterministic/process-exit-in-library
    process.exit(1);
  }
  return raw;
}
