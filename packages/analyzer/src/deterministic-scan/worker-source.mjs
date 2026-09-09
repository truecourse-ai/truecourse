// Worker threads need their own TypeScript loader. This entry is used only
// when the controller runs from source; compiled and bundled workers use JS.
import { tsImport } from 'tsx/esm/api'

await tsImport('./worker.ts', import.meta.url)
