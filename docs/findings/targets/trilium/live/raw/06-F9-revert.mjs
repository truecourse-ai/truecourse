import path from 'node:path';
import { startServer, stopServer, login, loadIds, recorder, SCRATCH } from './lib.mjs';
const ids = loadIds();
const R = recorder();
const server = await startServer();
try {
  const s = await login();
  R.log(`# F9 addendum - the process was restarted after the warm run above. Same DB, same note ${ids.tcSizeNote}.`);
  R.log(`# If the fix had been persisted, these would still answer. They do not: the memoisation died with the process.`);
  await R.probe(s, 'PROBE', `#tcprop9 note.contentSize >= 0`);
  await R.probe(s, 'PROBE', `#tcprop9 note.contentSize > 0`);
  R.log('');
  R.log('# and the non-"#" form still works on this cold process, then heals the "#" form again:');
  await R.probe(s, 'CONTROL', `note.contentSize > 0 AND #tcprop9`);
  await R.probe(s, 'AFTER', `#tcprop9 note.contentSize >= 0`);
} finally {
  await stopServer(server);
  R.dump(path.join(SCRATCH, 'probe', 'F9-revert-transcript.txt'));
}
