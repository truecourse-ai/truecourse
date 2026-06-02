// Barrel that re-exports the directory's public surface for callers
// outside the analyzed file set (tests, downstream packages). The presence
// of these re-exports means the underlying file is intentionally reachable
// even when no in-tree caller imports it directly.

export { isValidQueryShape, getQueryShapeError } from "./queryLinter";
