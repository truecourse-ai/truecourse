
// FP shape: createRequire called with import.meta.url (string) — types match Node.js signature
import { createRequire } from 'module';
import path from 'path';

class JobQueueServer {
  private setupDashboard() {
    const _require = createRequire(import.meta.url);
    const uiPackagePath = path.dirname(_require.resolve('some-ui-package/package.json'));
    return uiPackagePath;
  }
}
