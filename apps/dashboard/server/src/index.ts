/**
 * The process entry, for every edition: boot the one server, which registers
 * whatever bundle sits beside this tree before anything mounts.
 */

import { runServer } from './boot.js';

runServer();
