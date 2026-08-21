import path from 'node:path';
import { startServer, stopServer, login, loadIds, recorder, search, SCRATCH } from './lib.mjs';

const ids = loadIds();
const server = await startServer();
const R = recorder();
const full = async (s, label, q) => {
  const r = await search(s, q);
  const arr = Array.isArray(r.ids) ? r.ids : null;
  R.log(`${label.padEnd(9)} GET /api/search/${q}`);
  if (arr) {
    R.log(`          -> ${r.status} [${arr.length}] ${JSON.stringify(arr)}`);
    R.log(`             contains "root"? ${arr.includes('root')}   contains "_hidden"? ${arr.includes('_hidden')}`);
  } else R.log(`          -> ${r.status} ${r.raw}`);
  return arr;
};
try {
  const s = await login();
  R.log(`# F8 live re-run - COLD server. tcPropNote=${ids.tcPropNote} (#tcprop8) sits under tcbox=${ids.tcbox}.`);
  R.log('');
  R.log('=== PROBE - unrecognised note properties ===');
  await full(s, 'PROBE', `#tcprop8 AND not(note.ancestor.title = tcbox)`);
  await full(s, 'PROBE', `#tcprop8 note.noteSize > 50`);
  await full(s, 'PROBE', `#tcprop8 note.ownedAttributeCount >= 1`);
  R.log('');
  R.log('=== CONTROL - the recognised plural spelling, and the rest of the machinery ===');
  await full(s, 'CONTROL', `#tcprop8`);
  await full(s, 'CONTROL', `#tcprop8 AND not(note.ancestors.title = tcbox)`);
  await full(s, 'CONTROL', `#tcprop8 AND note.ancestors.title = tcbox`);
  await full(s, 'CONTROL', `#tcprop8 AND note.ancestors.title = nosuchbox`);
  await full(s, 'CONTROL', `#tcprop8 note.labelCount >= 1`);
  await full(s, 'CONTROL', `#tcprop8 AND not(note.type = code)`);
  R.log('');
  R.log('=== quick-search DOES surface the error the plain /api/search route drops ===');
  const qs = await s.api('GET', `/api/quick-search/${encodeURIComponent('#tcprop8 AND not(note.ancestor.title = tcbox)')}`);
  R.log(`GET /api/quick-search/#tcprop8 AND not(note.ancestor.title = tcbox) -> ${qs.status}`);
  R.log(`   error field: ${JSON.stringify(qs.json?.error)}`);
  R.log(`   result count: ${qs.json?.searchResultNoteIds?.length}`);
  R.log('');
  R.log('=== F9 addendum - the SAME cold process, bare non-"#" size queries (no "#" anywhere) ===');
  const a = await search(s, 'note.contentSize >= 0');
  R.log(`GET /api/search/note.contentSize >= 0 -> ${a.status} [${a.ids.length}]`);
  const b = await search(s, 'note.contentSize > 0');
  R.log(`GET /api/search/note.contentSize > 0  -> ${b.status} [${b.ids.length}]`);
  R.log(`(these two ran BEFORE any other non-"#" query in this process, i.e. cold, and both answered correctly)`);
} finally {
  await stopServer(server);
  R.dump(path.join(SCRATCH, 'probe', 'F8-transcript.txt'));
}
