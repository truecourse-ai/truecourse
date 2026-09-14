/** The enterprise edition's process entry: register this edition, then boot. */

import { runServer } from '@truecourse/dashboard-server';
import { registerEeServerFeatures } from './index.js';

registerEeServerFeatures();

runServer();
