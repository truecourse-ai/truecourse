import fs from 'node:fs';
import { startServer, stopServer, login, createNote, addLabel, saveIds, search } from './lib.mjs';

const server = await startServer();
try {
  const s = await login();
  const ids = {};
  const mk = async (parent, title, type, content) => {
    const r = await createNote(s, parent, { title, type, content });
    if (r.status !== 200) throw new Error(`create ${title} -> ${r.status} ${r.text}`);
    return r.json.note.noteId;
  };

  // ---- F7 fuzzy fixtures
  ids.tcFuzzyGood = await mk('root', 'tcFuzzyGood', 'text', 'fuzzy good');
  await addLabel(s, ids.tcFuzzyGood, 'tcfuzzy', 'trilium');
  ids.tcFuzzyOther = await mk('root', 'tcFuzzyOther', 'text', 'fuzzy other');
  await addLabel(s, ids.tcFuzzyOther, 'tcfuzzy', 'zebra');

  // ---- F8 property fixtures
  ids.tcbox = await mk('root', 'tcbox', 'text', 'a box');
  ids.tcPropNote = await mk(ids.tcbox, 'tcPropNote', 'text', 'inside the box');
  await addLabel(s, ids.tcPropNote, 'tcprop8', '');

  // ---- F9 size fixtures: a text note with real content and one real revision
  const body = 'x'.repeat(92);
  ids.tcSizeNote = await mk('root', 'tcSizeNote', 'text', body);
  await addLabel(s, ids.tcSizeNote, 'tcprop9', '');
  const blob = await s.api('GET', `/api/notes/${ids.tcSizeNote}/blob`);
  ids.tcSizeNoteBlobLen = blob.json?.content?.length ?? null;
  const rev = await s.api('POST', `/api/notes/${ids.tcSizeNote}/revision`);
  ids.tcSizeNoteRevision = { status: rev.status, body: rev.text };
  const revs = await s.api('GET', `/api/notes/${ids.tcSizeNote}/revisions`);
  ids.tcSizeNoteRevisionCount = Array.isArray(revs.json) ? revs.json.length : revs.text;

  // ---- F6 geolocation fixtures
  ids.tcGeoMarker = await mk('root', 'tcGeoMarker', 'text', 'a marker');
  await addLabel(s, ids.tcGeoMarker, 'geolocation', '48.8583,2.2945');
  ids.tcNoComma = await mk('root', 'tcNoComma', 'text', 'no comma');
  await addLabel(s, ids.tcNoComma, 'tcnocomma', '48.8583');
  const attrs = await s.api('GET', `/api/notes/${ids.tcGeoMarker}/attributes`);
  ids.tcGeoStoredValues = (attrs.json ?? []).filter(a => a.name === 'geolocation').map(a => a.value);

  // ---- F13 saved-search fixtures: two hits in different subtrees
  ids.tcSSBoxA = await mk('root', 'tcSSBoxA', 'text', 'box a');
  ids.tcSSBoxB = await mk('root', 'tcSSBoxB', 'text', 'box b');
  ids.tcHitAlpha = await mk(ids.tcSSBoxA, 'tcHitAlpha', 'text', 'alpha');
  await addLabel(s, ids.tcHitAlpha, 'tcfindme', '');
  ids.tcHitBeta = await mk(ids.tcSSBoxB, 'tcHitBeta', 'text', 'beta');
  await addLabel(s, ids.tcHitBeta, 'tcfindme', '');

  // ---- F11 clone fixtures: a note to clone, and a target branch to clone into
  ids.tcCloneSource = await mk('root', 'tcCloneSource', 'text', 'clone me');
  const tgt = await createNote(s, 'root', { title: 'tcCloneTarget', type: 'text', content: 'target' });
  ids.tcCloneTarget = tgt.json.note.noteId;
  ids.tcCloneTargetBranchId = tgt.json.branch.branchId;

  // ---- F17 titleTemplate parent (control)
  ids.tcTmplParent = await mk('root', 'tcTmplParent', 'text', 'template parent');
  await addLabel(s, ids.tcTmplParent, 'titleTemplate', '<b>bold</b> <script>x</script> plain');

  // total note count for reference
  const all = await search(s, 'note.type = *');
  ids._noteCountProbe = Array.isArray(all.ids) ? all.ids.length : all.raw;

  saveIds(ids);
  console.log(JSON.stringify(ids, null, 2));
} finally {
  await stopServer(server);
}
