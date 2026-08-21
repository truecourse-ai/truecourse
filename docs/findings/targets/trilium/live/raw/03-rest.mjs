import fs from 'node:fs';
import path from 'node:path';
import { startServer, stopServer, login, loadIds, recorder, search, createNote, SCRATCH, saveIds } from './lib.mjs';

const ids = loadIds();
const server = await startServer();
const R = recorder();
const out = {};
try {
  const s = await login();
  const shortList = (a) => Array.isArray(a) ? (a.length > 6 ? `[${a.length}] ${JSON.stringify(a.slice(0,6))}…` : `[${a.length}] ${JSON.stringify(a)}`) : String(a);
  const P = async (label, q) => { const r = await search(s, q); R.log(`${label.padEnd(9)} GET /api/search/${q}`); R.log(`          -> ${r.status} ${shortList(r.ids)}`); return r; };

  // =========================== F7 ===========================
  R.log('################ F7 - the fuzzy operators ~= / ~* never lex ################');
  R.log(`fixtures: tcFuzzyGood=${ids.tcFuzzyGood} (#tcfuzzy=trilium), tcFuzzyOther=${ids.tcFuzzyOther} (#tcfuzzy=zebra)`);
  R.log('--- PROBE');
  await P('PROBE', `#tcfuzzy ~= trilim`);
  await P('PROBE', `#tcfuzzy ~= qqqqqqq`);
  await P('PROBE', `#tcfuzzy ~* trilim`);
  await P('PROBE', `#tcfuzzy ~* qqqqqqq`);
  R.log('--- CONTROL');
  await P('CONTROL', `#tcfuzzy = trilium`);
  await P('CONTROL', `#tcfuzzy = zebra`);
  await P('CONTROL', `#tcfuzzy`);
  R.log('--- the property-path forms (the report noted these fail silently on this build)');
  await P('PROBE', `note.title ~= Books`);
  const cont = await P('PROBE', `note.content ~* zzzzznotpresent`);
  R.log(`          contains "root"? ${Array.isArray(cont.ids) && cont.ids.includes('root')}`);
  R.log('');

  // =========================== F6 ===========================
  R.log('################ F6 - the lexer strips commas even inside quotes ################');
  const geoAttrs = await s.api('GET', `/api/notes/${ids.tcGeoMarker}/attributes`);
  const stored = (geoAttrs.json ?? []).filter(a => a.name === 'geolocation').map(a => a.value);
  R.log(`GET /api/notes/${ids.tcGeoMarker}/attributes -> ${geoAttrs.status}  stored geolocation value(s): ${JSON.stringify(stored)}`);
  R.log('--- PROBE');
  await P('PROBE', `#geolocation="48.8583,2.2945"`);
  await P('PROBE', `#geolocation=48.8583,2.2945`);
  await P('PROBE', `#geolocation='48.8583,2.2945'`);
  R.log('--- CONTROL');
  await P('CONTROL', `#geolocation`);
  await P('CONTROL', `#tcnocomma="48.8583"`);
  await P('CONTROL', `#geolocation *=* 48.8583`);
  R.log('--- the undocumented escape hatch');
  await P('PROBE', `#geolocation="48.8583\\,2.2945"`);
  R.log('');

  // =========================== F11 ===========================
  R.log('################ F11 - clone-to-branch 500s on an empty body ################');
  const noBody = await s.api('PUT', `/api/notes/${ids.tcCloneSource}/clone-to-branch/${ids.tcCloneTargetBranchId}`, undefined, { noBody: true });
  R.log(`PROBE     PUT /api/notes/${ids.tcCloneSource}/clone-to-branch/${ids.tcCloneTargetBranchId}   (no body at all)`);
  R.log(`          -> ${noBody.status} ${noBody.text}`);
  const withBody = await s.api('PUT', `/api/notes/${ids.tcCloneSource}/clone-to-branch/${ids.tcCloneTargetBranchId}`, { prefix: null });
  R.log(`CONTROL   PUT /api/notes/${ids.tcCloneSource}/clone-to-branch/${ids.tcCloneTargetBranchId}   {"prefix": null}`);
  R.log(`          -> ${withBody.status} ${withBody.text}`);
  out.F11 = { noBody: { status: noBody.status, body: noBody.text }, withBody: { status: withBody.status, body: withBody.text } };
  R.log('');

  // =========================== F12 ===========================
  R.log('################ F12 - creating a typed note without `content` 500s ################');
  const mkraw = async (label, params) => {
    const r = await s.api('POST', `/api/notes/root/children?target=into`, params);
    R.log(`${label.padEnd(9)} POST /api/notes/root/children?target=into   ${JSON.stringify(params)}`);
    R.log(`          -> ${r.status} ${r.text.slice(0, 300)}`);
    return r;
  };
  const bookNo = await mkraw('PROBE', { title: 'tcprobebook', type: 'book' });
  const bookYes = await mkraw('CONTROL', { title: 'tcprobebook-control', type: 'book', content: '' });
  const textNo = await mkraw('PROBE', { title: 'tcprobetext', type: 'text' });
  const codeNo = await mkraw('PROBE', { title: 'tcprobecode', type: 'code' });
  const noTitle = await mkraw('CONTROL', { type: 'text', content: '' });
  R.log(`          (the missing-title control defaulted the title to ${JSON.stringify(noTitle.json?.note?.title)})`);
  out.F12 = { bookNo: { status: bookNo.status, body: bookNo.text }, bookYes: { status: bookYes.status }, textNo: { status: textNo.status, body: textNo.text }, codeNo: { status: codeNo.status, body: codeNo.text }, defaultedTitle: noTitle.json?.note?.title };
  R.log('');

  // =========================== F17 ===========================
  R.log('################ F17 - note titles are never HTML-sanitised ################');
  const PAYLOAD = '<b>bold</b> <script>x</script> plain';
  const created = await s.api('POST', `/api/notes/root/children?target=into`, { title: PAYLOAD, type: 'text', content: 'body' });
  const cId = created.json.note.noteId;
  ids.tcXssCreated = cId;
  R.log(`PROBE1    POST /api/notes/root/children?target=into  {"title":${JSON.stringify(PAYLOAD)},"type":"text","content":"body"}`);
  R.log(`          -> ${created.status}   response title: ${JSON.stringify(created.json.note.title)}`);
  const readBack = await s.api('GET', `/api/notes/${cId}`);
  R.log(`          GET /api/notes/${cId} stored title: ${JSON.stringify(readBack.json.title)}`);
  const plain = await s.api('POST', `/api/notes/root/children?target=into`, { title: 'tcRenameMe', type: 'text', content: 'body' });
  const rId = plain.json.note.noteId;
  ids.tcXssRenamed = rId;
  const renamed = await s.api('PUT', `/api/notes/${rId}/title`, { title: PAYLOAD });
  R.log(`PROBE2    PUT /api/notes/${rId}/title  {"title":${JSON.stringify(PAYLOAD)}}  -> ${renamed.status}`);
  const readBack2 = await s.api('GET', `/api/notes/${rId}`);
  R.log(`          GET /api/notes/${rId} stored title: ${JSON.stringify(readBack2.json.title)}`);
  const tree = await s.api('POST', `/api/tree/load`, { noteIds: [cId, rId] });
  const titles = (tree.json?.notes ?? []).filter(n => [cId, rId].includes(n.noteId)).map(n => n.title);
  R.log(`          POST /api/tree/load titles: ${JSON.stringify(titles)}`);
  const derived = await s.api('POST', `/api/notes/${ids.tcTmplParent}/children?target=into`, { type: 'text', content: '' });
  R.log(`CONTROL   POST /api/notes/${ids.tcTmplParent}/children?target=into  {"type":"text","content":""}   (parent carries #titleTemplate=${JSON.stringify(PAYLOAD)}, no title key sent)`);
  R.log(`          -> ${derived.status}   derived title: ${JSON.stringify(derived.json?.note?.title)}`);
  out.F17 = { createdTitle: created.json.note.title, storedTitle: readBack.json.title, renamedStored: readBack2.json.title, treeTitles: titles, derivedTitle: derived.json?.note?.title };
  R.log('');

  // =========================== F13 (API half) ===========================
  R.log('################ F13 - a saved search does not execute itself (API half) ################');
  const sn = await s.api('POST', `/api/special-notes/search-note`, {});
  const snId = sn.json.note?.noteId ?? sn.json.noteId;
  ids.tcSavedSearch = snId;
  R.log(`POST /api/special-notes/search-note -> ${sn.status}  noteId=${snId} type=${sn.json.note?.type} title=${JSON.stringify(sn.json.note?.title)}`);
  const snAttrs0 = await s.api('GET', `/api/notes/${snId}/attributes`);
  const own0 = (snAttrs0.json ?? []).filter(a => a.noteId === snId);
  R.log(`born with: ${JSON.stringify(own0.map(a => `${a.name}=${a.value}`))}`);
  const updated = own0.map(a => a.name === 'searchString' ? { ...a, value: '#tcfindme' } : a);
  const put = await s.api('PUT', `/api/notes/${snId}/attributes`, updated);
  R.log(`PUT /api/notes/${snId}/attributes (searchString -> "#tcfindme") -> ${put.status}`);
  const snAttrs1 = await s.api('GET', `/api/notes/${snId}/attributes`);
  R.log(`now:       ${JSON.stringify((snAttrs1.json ?? []).filter(a => a.noteId === snId).map(a => `${a.name}=${a.value}`))}`);
  const load1 = await s.api('POST', `/api/tree/load`, { noteIds: [snId] });
  const kids1 = (load1.json?.branches ?? []).filter(b => b.parentNoteId === snId);
  R.log(`POST /api/tree/load -> children of the saved search: ${kids1.length}`);
  R.log('--- CONTROL A: the query is valid and the server runs it on demand');
  const fromNote = await s.api('GET', `/api/search-note/${snId}`);
  R.log(`GET /api/search-note/${snId} -> ${fromNote.status} ${JSON.stringify(fromNote.json)}`);
  await P('CONTROL', `#tcfindme`);
  const load2 = await s.api('POST', `/api/tree/load`, { noteIds: [snId] });
  const kids2 = (load2.json?.branches ?? []).filter(b => b.parentNoteId === snId);
  R.log(`POST /api/tree/load again -> children: ${kids2.length}   (results are in-memory only)`);
  out.F13 = { savedSearchId: snId, bornAttrs: own0.map(a => `${a.name}=${a.value}`), childrenBefore: kids1.length, childrenAfter: kids2.length, searchFromNote: fromNote.json };
  saveIds(ids);
  R.log('');
  R.log(`(the saved search note id for the browser half is ${snId}; hits are tcHitAlpha=${ids.tcHitAlpha} tcHitBeta=${ids.tcHitBeta})`);
} finally {
  await stopServer(server);
  R.dump(path.join(SCRATCH, 'probe', 'rest-transcript.txt'));
  fs.writeFileSync(path.join(SCRATCH, 'probe', 'rest-raw.json'), JSON.stringify(out, null, 2));
}
