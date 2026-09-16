/**
 * The process entry, for every edition: register whatever bundle sits beside
 * this tree, then boot the one server.
 */

import { runServer } from './boot.js';
import { registerEditionFeatures } from './edition-loader.js';

registerEditionFeatures().then(
  () => runServer(),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
