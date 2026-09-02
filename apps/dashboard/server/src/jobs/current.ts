/**
 * The job runner this process is serving with, for the routes that enqueue onto
 * it. `createApp` installs the mount it was handed; a route that reaches here
 * on a server whose queue never came up gets the same honest 503 the
 * `/api/jobs` surface answers with.
 */

import { createAppError } from '@truecourse/core/lib/errors';
import type { JobsMount } from './index.js';

let mount: JobsMount | null = null;

export function setCurrentJobs(next: JobsMount | null): void {
  mount = next;
}

export function requireJobs(): JobsMount {
  if (!mount) {
    throw createAppError('Background jobs are not running on this server.', 503);
  }
  return mount;
}
