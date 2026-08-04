// The fixture's build step: copy `src/` to `dist/`, the shape a `tsc` build has
// (a start script pointing at an artifact that does not exist until the build
// runs) without needing a compiler on disk. Dependency-free ON PURPOSE — the
// end-to-end recipe test really runs this build and really boots the result, so
// it must work offline.
import fs from 'node:fs'

fs.rmSync('dist', { recursive: true, force: true })
fs.cpSync('src', 'dist', { recursive: true })
