/**
 * Every server feature this edition adds, in the order they mount. Held apart
 * from the registration below so the list can be read without booting anything.
 */

import type { ServerFeature } from '@truecourse/dashboard-server';
import { connectionsFeature } from './connections/index.js';
import { workspacesFeature } from './workspaces/index.js';

export const eeServerFeatures: readonly ServerFeature[] = [workspacesFeature, connectionsFeature];
